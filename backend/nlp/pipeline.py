# nlp/pipeline.py — Review Intel NLP pipeline
#
# Models used:
#   Sentiment : cardiffnlp/twitter-roberta-base-sentiment-latest
#   Keywords  : KeyBERT (sentence-transformers/all-MiniLM-L6-v2)
#   Aspects   : spaCy en_core_web_sm (noun chunk extraction)
#   Summary   : facebook/bart-large-cnn  (optional, falls back to extractive)

import re
import logging
from collections import defaultdict, Counter
from typing import List, Dict, Any, Optional, Tuple

import torch
from transformers import (
    AutoTokenizer,
    AutoModelForSequenceClassification,
    pipeline as hf_pipeline,
)
from keybert import KeyBERT
import spacy

logger = logging.getLogger(__name__)


# ── Aspect vocabulary ─────────────────────────────────────────────────────────
# Seed terms that get expanded via spaCy noun chunks

ASPECT_SEEDS = {
    "battery":     ["battery", "battery life", "charge", "charging", "drain", "mah"],
    "camera":      ["camera", "photo", "picture", "video", "lens", "zoom", "megapixel", "mp", "selfie", "sensor"],
    "display":     ["display", "screen", "amoled", "oled", "lcd", "resolution", "brightness", "refresh", "panel"],
    "performance": ["performance", "speed", "processor", "cpu", "gpu", "lag", "freeze", "fast", "slow", "snapdragon", "exynos", "chip"],
    "build":       ["build", "quality", "material", "design", "frame", "body", "premium", "plastic", "metal", "glass", "finish"],
    "heating":     ["heat", "heating", "hot", "warm", "temperature", "thermal", "overheat"],
    "software":    ["software", "android", "ui", "one ui", "miui", "bloat", "update", "os", "feature", "app"],
    "price":       ["price", "cost", "value", "expensive", "cheap", "worth", "money", "budget"],
    "audio":       ["audio", "speaker", "sound", "microphone", "mic", "earphone", "volume"],
    "connectivity":["wifi", "bluetooth", "5g", "4g", "signal", "network", "nfc", "gps"],
}

# Flatten seed → aspect lookup
TERM_TO_ASPECT: Dict[str, str] = {}
for aspect, terms in ASPECT_SEEDS.items():
    for term in terms:
        TERM_TO_ASPECT[term.lower()] = aspect


class ReviewPipeline:

    def __init__(self):
        self.model_name = "cardiffnlp/twitter-roberta-base-sentiment-latest"
        self.device = 0 if torch.cuda.is_available() else -1

        logger.info(f"Loading sentiment model: {self.model_name}")
        self.sentiment_pipe = hf_pipeline(
            "text-classification",
            model=self.model_name,
            tokenizer=self.model_name,
            device=self.device,
            batch_size=16,
            truncation=True,
            max_length=512,
        )

        logger.info("Loading KeyBERT")
        self.kw_model = KeyBERT()

        logger.info("Loading spaCy")
        try:
            self.nlp = spacy.load("en_core_web_sm", disable=["ner", "parser"])
            self.nlp.enable_pipe("senter")   # sentence segmenter only
        except OSError:
            logger.warning("spaCy model not found. Run: python -m spacy download en_core_web_sm")
            self.nlp = None

        # Optional summarizer — lazy loaded
        self._summarizer = None

    # ── Sentiment classification ──────────────────────────────────────────────

    def classify_sentiment_batch(self, texts: List[str]) -> List[Dict]:
        """
        Returns list of {label, score} dicts.
        Labels: 'positive' | 'neutral' | 'negative'
        """
        if not texts:
            return []

        # Truncate long texts for the model
        cleaned = [self._clean(t)[:512] for t in texts]

        results = self.sentiment_pipe(cleaned)

        normalized = []
        for r in results:
            label = r["label"].lower()
            # cardiffnlp model returns 'positive'/'neutral'/'negative'
            if label not in ("positive", "neutral", "negative"):
                # fallback mapping (some model versions use 0/1/2 labels)
                label = {"label_0": "negative", "label_1": "neutral", "label_2": "positive"}.get(label, "neutral")
            normalized.append({"sentiment": label, "confidence": round(r["score"], 3)})

        return normalized

    # ── Aspect extraction ─────────────────────────────────────────────────────

    def extract_aspects_from_text(self, text: str) -> List[str]:
        """Match seed terms in text. Returns list of matched aspect names."""
        text_lower = text.lower()
        found = set()
        for term, aspect in TERM_TO_ASPECT.items():
            if term in text_lower:
                found.add(aspect)
        return list(found)

    def extract_aspects_batch(self, texts: List[str]) -> Dict[str, Dict[str, int]]:
        """Returns aspect → {positive, negative, neutral, total} counts across all texts."""
        aspect_counts: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))

        sentiments = self.classify_sentiment_batch(texts)

        for text, sent_info in zip(texts, sentiments):
            aspects = self.extract_aspects_from_text(text)
            sentiment = sent_info["sentiment"]
            for aspect in aspects:
                aspect_counts[aspect][sentiment] += 1
                aspect_counts[aspect]["total"] += 1

        return {k: dict(v) for k, v in aspect_counts.items()}

    # ── Aspect-sentiment mapping ──────────────────────────────────────────────

    def map_aspect_sentiments(self, reviews_with_sentiments: List[Dict]) -> Dict[str, Dict[str, float]]:
        """
        Given reviews that already have sentiment classified,
        compute per-aspect positive/negative percentage.
        """
        aspect_scores: Dict[str, Dict[str, int]] = defaultdict(lambda: {"positive": 0, "negative": 0, "neutral": 0, "total": 0})

        for r in reviews_with_sentiments:
            text = f"{r.get('title', '')} {r.get('body', '')}".strip()
            aspects = self.extract_aspects_from_text(text)
            sentiment = r.get("sentiment", "neutral")

            for aspect in aspects:
                aspect_scores[aspect][sentiment] += 1
                aspect_scores[aspect]["total"] += 1

        # Convert to percentages
        result = {}
        for aspect, counts in aspect_scores.items():
            total = counts["total"]
            if total == 0:
                continue
            result[aspect] = {
                "positive": round(counts["positive"] / total * 100, 1),
                "negative": round(counts["negative"] / total * 100, 1),
                "neutral":  round(counts["neutral"]  / total * 100, 1),
                "total":    total,
            }

        return result

    # ── Keyword extraction ────────────────────────────────────────────────────

    def extract_keywords(self, texts: List[str], top_n: int = 15) -> List[str]:
        combined = " ".join(texts[:50])  # limit corpus size
        try:
            kws = self.kw_model.extract_keywords(
                combined,
                keyphrase_ngram_range=(1, 2),
                stop_words="english",
                top_n=top_n,
                diversity=0.5,
            )
            return [kw[0] for kw in kws]
        except Exception as e:
            logger.warning(f"KeyBERT failed: {e}")
            return []

    # ── Summary generation ────────────────────────────────────────────────────

    def generate_summary(self, reviews: List[Dict], aspect_sentiments: Dict) -> str:
        """Extractive summary — picks representative sentences."""
        bodies = [r.get("body", "") for r in reviews if r.get("body")]

        # Find top positive aspect
        top_pos = max(
            aspect_sentiments.items(),
            key=lambda x: x[1].get("positive", 0),
            default=(None, {}),
        )[0]

        # Find top negative aspect
        top_neg = max(
            aspect_sentiments.items(),
            key=lambda x: x[1].get("negative", 0),
            default=(None, {}),
        )[0]

        pos_count = sum(1 for r in reviews if r.get("sentiment") == "positive")
        neg_count = sum(1 for r in reviews if r.get("sentiment") == "negative")
        total = len(reviews)
        pos_pct = round(pos_count / total * 100) if total else 0

        parts = [f"{pos_pct}% of {total} reviews are positive."]

        if top_pos:
            score = aspect_sentiments[top_pos]["positive"]
            parts.append(f"Users consistently praise {top_pos} ({score:.0f}% positive mentions).")

        if top_neg and top_neg != top_pos:
            score = aspect_sentiments[top_neg]["negative"]
            parts.append(f"The most common complaint is {top_neg} ({score:.0f}% negative mentions).")

        return " ".join(parts)

    def generate_verdict(self, reviews: List[Dict], aspect_sentiments: Dict) -> str:
        pos_count = sum(1 for r in reviews if r.get("sentiment") == "positive")
        total = len(reviews)
        pos_pct = pos_count / total if total else 0

        top_pos = max(aspect_sentiments.items(), key=lambda x: x[1].get("positive", 0), default=(None, {}))[0]
        top_neg = max(aspect_sentiments.items(), key=lambda x: x[1].get("negative", 0), default=(None, {}))[0]

        if pos_pct >= 0.75:
            rec = "Highly recommended."
        elif pos_pct >= 0.55:
            rec = "Generally recommended with caveats."
        else:
            rec = "Not recommended — majority of reviews are negative."

        parts = [rec]
        if top_pos:
            parts.append(f"Best feature: {top_pos}.")
        if top_neg and top_neg != top_pos:
            parts.append(f"Main weakness: {top_neg}.")

        return " ".join(parts)

    # ── Common complaints ─────────────────────────────────────────────────────

    def extract_common_complaints(self, reviews: List[Dict], top_n: int = 6) -> List[str]:
        neg_reviews = [r for r in reviews if r.get("sentiment") == "negative"]
        if not neg_reviews:
            return []

        aspect_counter: Counter = Counter()
        for r in neg_reviews:
            text = f"{r.get('title', '')} {r.get('body', '')}".strip()
            for aspect in self.extract_aspects_from_text(text):
                aspect_counter[aspect] += 1

        return [aspect for aspect, _ in aspect_counter.most_common(top_n)]

    # ── Main run ──────────────────────────────────────────────────────────────

    def run(self, product: Dict, reviews: List[Dict]) -> Dict[str, Any]:
        logger.info(f"Pipeline start: {len(reviews)} reviews for ASIN {product.get('asin')}")

        # 1. Classify sentiment for all reviews
        bodies = [f"{r.get('title', '')} {r.get('body', '')}".strip() for r in reviews]
        sentiments = self.classify_sentiment_batch(bodies)

        # Attach sentiment to reviews
        annotated = []
        for r, sent in zip(reviews, sentiments):
            text = f"{r.get('title', '')} {r.get('body', '')}".strip()
            aspects = self.extract_aspects_from_text(text)
            annotated.append({
                **r,
                "sentiment":  sent["sentiment"],
                "confidence": sent["confidence"],
                "aspects":    aspects,
            })

        # 2. Aggregate sentiment distribution
        dist = Counter(r["sentiment"] for r in annotated)
        sentiment_distribution = {
            "positive": dist.get("positive", 0),
            "neutral":  dist.get("neutral", 0),
            "negative": dist.get("negative", 0),
        }

        # 3. Aspect-level sentiment
        aspect_sentiments = self.map_aspect_sentiments(annotated)

        # 4. Top features
        top_pos = max(aspect_sentiments.items(), key=lambda x: x[1].get("positive", 0), default=(None, {}))[0]
        top_neg = max(aspect_sentiments.items(), key=lambda x: x[1].get("negative", 0), default=(None, {}))[0]

        # 5. Keywords
        keywords = self.extract_keywords([r.get("body", "") for r in reviews])

        # 6. Common complaints
        complaints = self.extract_common_complaints(annotated)

        # 7. Summary + verdict
        summary = self.generate_summary(annotated, aspect_sentiments)
        verdict = self.generate_verdict(annotated, aspect_sentiments)

        logger.info("Pipeline complete")

        return {
            "product":               product,
            "total_reviews":         len(annotated),
            "sentiment_distribution": sentiment_distribution,
            "aspect_sentiments":     aspect_sentiments,
            "top_positive_feature":  top_pos,
            "top_negative_feature":  top_neg,
            "common_complaints":     complaints,
            "keywords":              keywords,
            "summary":               summary,
            "verdict":               verdict,
            "reviews":               annotated,
        }

    # ── Utils ─────────────────────────────────────────────────────────────────

    @staticmethod
    def _clean(text: str) -> str:
        text = re.sub(r'<[^>]+>', ' ', text)           # strip HTML
        text = re.sub(r'[^\x00-\x7F]+', ' ', text)    # remove non-ASCII
        text = re.sub(r'\s+', ' ', text).strip()
        return text
