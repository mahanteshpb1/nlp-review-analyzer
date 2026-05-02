import { useState, useEffect, useRef } from "react";
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  LineChart, Line, Area, AreaChart,
} from "recharts";

// ── Color tokens ───────────────────────────────────────────────────────────────
const C = {
  bg:       "#0a0a0f",
  surface:  "#111118",
  border:   "rgba(255,255,255,0.07)",
  accent:   "#6ee7f7",
  positive: "#4ade80",
  neutral:  "#facc15",
  negative: "#f87171",
  text:     "#e8e8f0",
  muted:    "#6b6b80",
};

const SENTIMENT_COLORS = {
  positive: C.positive,
  neutral:  C.neutral,
  negative: C.negative,
};

// ── Tiny reusable primitives ───────────────────────────────────────────────────

function Badge({ type }) {
  const map = { positive: [C.positive, "Positive"], neutral: [C.neutral, "Neutral"], negative: [C.negative, "Negative"] };
  const [color, label] = map[type] || [C.muted, type];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "2px 10px", borderRadius: 50,
      background: color + "18", border: `1px solid ${color}44`,
      color, fontSize: 11, fontWeight: 600, letterSpacing: "0.05em",
      textTransform: "uppercase",
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: color }} />
      {label}
    </span>
  );
}

function Card({ children, style = {} }) {
  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 16,
      padding: "20px 22px",
      ...style,
    }}>
      {children}
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <h3 style={{
      margin: "0 0 16px", fontSize: 12, fontWeight: 700,
      color: C.muted, letterSpacing: "0.1em",
      textTransform: "uppercase",
    }}>
      {children}
    </h3>
  );
}

// ── Custom Tooltip ─────────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#1a1a26", border: `1px solid ${C.border}`,
      borderRadius: 10, padding: "10px 14px", fontSize: 12,
    }}>
      {label && <p style={{ color: C.muted, marginBottom: 6 }}>{label}</p>}
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color || C.text, margin: "2px 0" }}>
          {p.name}: <strong>{p.value}</strong>
        </p>
      ))}
    </div>
  );
};

// ── Sentiment Donut ────────────────────────────────────────────────────────────
function SentimentDonut({ distribution }) {
  const total = Object.values(distribution).reduce((a, b) => a + b, 0);
  const data = [
    { name: "Positive", value: distribution.positive, color: C.positive },
    { name: "Neutral",  value: distribution.neutral,  color: C.neutral },
    { name: "Negative", value: distribution.negative, color: C.negative },
  ];

  return (
    <Card>
      <SectionTitle>Sentiment Overview</SectionTitle>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ position: "relative", width: 160, height: 160, flexShrink: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={50} outerRadius={72}
                dataKey="value" stroke="none" paddingAngle={2}>
                {data.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            pointerEvents: "none",
          }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: C.text }}>{total}</span>
            <span style={{ fontSize: 10, color: C.muted }}>reviews</span>
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
          {data.map(d => (
            <div key={d.name}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: C.muted }}>{d.name}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: d.color }}>
                  {total ? Math.round(d.value / total * 100) : 0}%
                </span>
              </div>
              <div style={{ height: 4, background: C.border, borderRadius: 99 }}>
                <div style={{
                  height: "100%", borderRadius: 99, background: d.color,
                  width: `${total ? d.value / total * 100 : 0}%`,
                  transition: "width 1s ease",
                }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ── Aspect Bar Chart ───────────────────────────────────────────────────────────
function AspectChart({ aspectSentiment }) {
  const data = aspectSentiment.slice(0, 8).map(a => ({
    aspect: a.aspect.charAt(0).toUpperCase() + a.aspect.slice(1),
    Positive: a.positive,
    Neutral: a.neutral,
    Negative: a.negative,
  }));

  return (
    <Card>
      <SectionTitle>Aspect Breakdown</SectionTitle>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 10 }}
          barCategoryGap="30%">
          <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} />
          <XAxis type="number" tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="aspect" tick={{ fill: C.text, fontSize: 11 }}
            axisLine={false} tickLine={false} width={72} />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
          <Bar dataKey="Positive" stackId="a" fill={C.positive} radius={[0, 0, 0, 0]} />
          <Bar dataKey="Neutral"  stackId="a" fill={C.neutral} />
          <Bar dataKey="Negative" stackId="a" fill={C.negative} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

// ── Trend Line ─────────────────────────────────────────────────────────────────
function TrendChart({ trends }) {
  if (!trends.length) return null;
  return (
    <Card>
      <SectionTitle>Sentiment Over Time</SectionTitle>
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={trends} margin={{ left: -24, right: 8 }}>
          <defs>
            {[["pos", C.positive], ["neu", C.neutral], ["neg", C.negative]].map(([id, color]) => (
              <linearGradient key={id} id={`grad-${id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={color} stopOpacity={0.25} />
                <stop offset="95%" stopColor={color} stopOpacity={0}   />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
          <XAxis dataKey="period" tick={{ fill: C.muted, fontSize: 9 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: C.muted, fontSize: 9 }} axisLine={false} tickLine={false} />
          <Tooltip content={<CustomTooltip />} />
          <Area type="monotone" dataKey="positive" name="Positive" stroke={C.positive} fill="url(#grad-pos)" strokeWidth={2} dot={false} />
          <Area type="monotone" dataKey="neutral"  name="Neutral"  stroke={C.neutral}  fill="url(#grad-neu)" strokeWidth={2} dot={false} />
          <Area type="monotone" dataKey="negative" name="Negative" stroke={C.negative} fill="url(#grad-neg)" strokeWidth={2} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  );
}

// ── Insights ───────────────────────────────────────────────────────────────────
function Insights({ insights }) {
  return (
    <Card>
      <SectionTitle>AI Insights</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {insights.map((ins, i) => {
          const color = ins.type === "praise" ? C.positive : ins.type === "complaint" ? C.negative : C.neutral;
          const icon  = ins.type === "praise" ? "↑" : ins.type === "complaint" ? "↓" : "→";
          return (
            <div key={i} style={{
              display: "flex", gap: 10, alignItems: "flex-start",
              padding: "10px 12px",
              background: color + "0d",
              border: `1px solid ${color}22`,
              borderRadius: 10,
            }}>
              <span style={{ color, fontWeight: 700, fontSize: 14, marginTop: 1 }}>{icon}</span>
              <div>
                <p style={{ margin: 0, fontSize: 12, color: C.text, lineHeight: 1.5 }}>{ins.text}</p>
                <span style={{ fontSize: 10, color: C.muted }}>{ins.count} mentions</span>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Keywords ───────────────────────────────────────────────────────────────────
function Keywords({ keywords }) {
  return (
    <Card>
      <SectionTitle>Top Keywords</SectionTitle>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {keywords.slice(0, 16).map((kw, i) => (
          <span key={i} style={{
            padding: "4px 10px", borderRadius: 50,
            background: C.border,
            color: C.text, fontSize: 11,
            border: `1px solid rgba(255,255,255,0.06)`,
          }}>
            {kw}
          </span>
        ))}
      </div>
    </Card>
  );
}

// ── Review List ────────────────────────────────────────────────────────────────
const FILTERS = ["all", "positive", "neutral", "negative"];
const SORTS   = ["helpful", "latest", "highest", "lowest"];

function ReviewList({ reviews }) {
  const [filter, setFilter] = useState("all");
  const [sort, setSort]     = useState("helpful");
  const [search, setSearch] = useState("");
  const [page, setPage]     = useState(1);
  const PER_PAGE = 5;

  const filtered = reviews
    .filter(r => filter === "all" || r.sentiment === filter)
    .filter(r => !search || r.text.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sort === "helpful") return b.helpful - a.helpful;
      if (sort === "latest")  return b.date.localeCompare(a.date);
      if (sort === "highest") return b.rating - a.rating;
      if (sort === "lowest")  return a.rating - b.rating;
      return 0;
    });

  const paged    = filtered.slice(0, page * PER_PAGE);
  const hasMore  = paged.length < filtered.length;

  return (
    <Card>
      <SectionTitle>Reviews ({filtered.length})</SectionTitle>

      {/* Filters */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {FILTERS.map(f => (
          <button key={f} onClick={() => { setFilter(f); setPage(1); }} style={{
            padding: "5px 12px", borderRadius: 50, fontSize: 11,
            fontWeight: 600, cursor: "pointer", textTransform: "capitalize",
            background: filter === f ? C.accent + "22" : "transparent",
            border: `1px solid ${filter === f ? C.accent : C.border}`,
            color: filter === f ? C.accent : C.muted,
            transition: "all 0.15s",
          }}>{f}</button>
        ))}
        <select value={sort} onChange={e => setSort(e.target.value)} style={{
          marginLeft: "auto", padding: "5px 10px", borderRadius: 8,
          background: C.surface, border: `1px solid ${C.border}`,
          color: C.muted, fontSize: 11, cursor: "pointer",
        }}>
          {SORTS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
      </div>

      {/* Search */}
      <input
        placeholder="Search reviews…"
        value={search}
        onChange={e => { setSearch(e.target.value); setPage(1); }}
        style={{
          width: "100%", padding: "8px 12px", borderRadius: 8,
          background: "#0d0d16", border: `1px solid ${C.border}`,
          color: C.text, fontSize: 12, marginBottom: 12,
          outline: "none", boxSizing: "border-box",
        }}
      />

      {/* Items */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {paged.map(r => (
          <div key={r.id} style={{
            padding: "12px 14px", borderRadius: 10,
            background: "#0d0d16", border: `1px solid ${C.border}`,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 12, color: C.text }}>{r.username}</span>
                <Stars rating={r.rating} />
              </div>
              <Badge type={r.sentiment} />
            </div>
            <p style={{ margin: "0 0 8px", fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
              {r.text.length > 220 ? r.text.slice(0, 220) + "…" : r.text}
            </p>
            {r.aspects && Object.keys(r.aspects).length > 0 && (
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {Object.entries(r.aspects).map(([asp, sent]) => (
                  <span key={asp} style={{
                    padding: "2px 7px", borderRadius: 4,
                    background: SENTIMENT_COLORS[sent] + "18",
                    color: SENTIMENT_COLORS[sent],
                    fontSize: 10, fontWeight: 500,
                  }}>{asp}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {hasMore && (
        <button onClick={() => setPage(p => p + 1)} style={{
          width: "100%", marginTop: 12, padding: "8px",
          background: "transparent", border: `1px solid ${C.border}`,
          color: C.muted, borderRadius: 8, cursor: "pointer",
          fontSize: 12,
        }}>
          Load more
        </button>
      )}
    </Card>
  );
}

function Stars({ rating }) {
  return (
    <span style={{ display: "flex", gap: 1 }}>
      {[1,2,3,4,5].map(i => (
        <span key={i} style={{ color: i <= Math.round(rating) ? C.neutral : C.border, fontSize: 10 }}>★</span>
      ))}
    </span>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [data, setData]   = useState(null);
  const [title, setTitle] = useState("");
  const [tab, setTab]     = useState("overview");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const handler = (event) => {
      if (event.data?.type === "REVIEWLENS_DATA") {
        setData(event.data.payload.data);
        setTitle(event.data.payload.productTitle);
        setReady(true);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  if (!ready) {
    return (
      <div style={{
        height: "100vh", background: C.bg,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        fontFamily: "'DM Sans', sans-serif", color: C.muted,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: "50%",
          border: `2px solid ${C.border}`,
          borderTop: `2px solid ${C.accent}`,
          animation: "spin 0.8s linear infinite",
          marginBottom: 16,
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <p style={{ fontSize: 13 }}>Analyzing reviews…</p>
      </div>
    );
  }

  const { sentiment_distribution, aspect_sentiment, trends, insights, top_keywords, reviews } = data;

  const TABS = [
    { id: "overview", label: "Overview" },
    { id: "aspects",  label: "Aspects" },
    { id: "reviews",  label: "Reviews" },
  ];

  return (
    <div style={{
      height: "100vh", background: C.bg, color: C.text,
      fontFamily: "'DM Sans', 'Inter', -apple-system, sans-serif",
      display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "16px 20px",
        borderBottom: `1px solid ${C.border}`,
        background: C.surface,
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: C.accent, flexShrink: 0,
            boxShadow: `0 0 8px ${C.accent}`,
          }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: C.accent, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            ReviewLens
          </span>
        </div>
        <h2 style={{
          margin: 0, fontSize: 13, fontWeight: 600,
          color: C.text, lineHeight: 1.4,
          display: "-webkit-box", WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>
          {title}
        </h2>
        <p style={{ margin: "4px 0 0", fontSize: 11, color: C.muted }}>
          {data.total_reviews} reviews analyzed
        </p>
      </div>

      {/* Tabs */}
      <div style={{
        display: "flex", borderBottom: `1px solid ${C.border}`,
        background: C.surface, flexShrink: 0,
      }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, padding: "11px 0",
            background: "transparent",
            border: "none", borderBottom: `2px solid ${tab === t.id ? C.accent : "transparent"}`,
            color: tab === t.id ? C.accent : C.muted,
            fontSize: 12, fontWeight: 600, cursor: "pointer",
            transition: "all 0.15s",
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{
        flex: 1, overflowY: "auto",
        padding: "16px",
        display: "flex", flexDirection: "column", gap: 12,
      }}>
        {tab === "overview" && (
          <>
            <SentimentDonut distribution={sentiment_distribution} />
            <TrendChart trends={trends} />
            <Insights insights={insights} />
            <Keywords keywords={top_keywords} />
          </>
        )}
        {tab === "aspects" && (
          <>
            <AspectChart aspectSentiment={aspect_sentiment} />
            {aspect_sentiment.map(a => (
              <Card key={a.aspect} style={{ padding: "14px 18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 13, textTransform: "capitalize" }}>{a.aspect}</span>
                  <span style={{
                    fontSize: 11, fontWeight: 700,
                    color: a.score >= 0.2 ? C.positive : a.score <= -0.2 ? C.negative : C.neutral,
                  }}>
                    {a.score >= 0.2 ? "↑ Positive" : a.score <= -0.2 ? "↓ Negative" : "→ Mixed"}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8, fontSize: 11, color: C.muted }}>
                  <span style={{ color: C.positive }}>▲ {a.positive}</span>
                  <span style={{ color: C.neutral  }}>● {a.neutral}</span>
                  <span style={{ color: C.negative }}>▼ {a.negative}</span>
                </div>
              </Card>
            ))}
          </>
        )}
        {tab === "reviews" && <ReviewList reviews={reviews} />}
      </div>
    </div>
  );
}
