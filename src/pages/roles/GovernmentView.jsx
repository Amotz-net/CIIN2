import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { getAfai, getDrift } from '../../lib/feeds'
import { computeScores, scoreTone } from '../../lib/riskscores'
import { computeLandfall } from '../../lib/landfall'
import { runAgent } from '../../lib/agent'
import { runCapture, loadKnowledge, loadReviews, decideReview } from '../../lib/capture'
import { CoastMap } from './CoastMap.jsx'
import { RoleReports } from './Reports.jsx'
import { Landfall } from '../../components/Landfall.jsx'

// Government dashboard — the jurisdiction/funder-facing view.
// Reads operational data across ALL orgs in its country (RLS 0011), overlays
// live satellite risk per segment, and shows three risk scores at honest tiers
// plus a directional carbon exposure figure.
//
// Sections are STRICT: each nav tab renders only its own panels. Overview is
// the situational picture — map, landfall watch, jurisdiction summary, risk
// scores, agent. Knowledge Hub, Carbon, Coast Map and Reports live on their
// own tabs and no longer stack below the agent.

const TIER_PILL = { live: 'teal', 'live-informed': 'blue', directional: 'amber' }
const CO2E_PER_T = 0.30  // t CO2e per t wet sargassum (directional, published range)
const REFRESH_MS = 90_000

// Ticking "updated Xs ago" — kept in a leaf so the second-hand doesn't
// re-render the map or the agent panel.
function LiveDot({ at, refreshing }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(id)
  }, [])
  if (!at) return <span className="live stale"><span className="dot" />connecting</span>
  const secs = Math.floor((Date.now() - at) / 1000)
  const stale = secs > REFRESH_MS / 1000 + 30
  const ago = refreshing ? 'refreshing…' : secs < 5 ? 'just now' : secs < 90 ? `${secs}s ago` : `${Math.floor(secs / 60)}m ago`
  return <span className={'live' + (stale ? ' stale' : '')}><span className="dot" />live · {ago}</span>
}

function ScoreCard({ title, score }) {
  const tier = score?.tier || 'directional'
  const tone = scoreTone(score?.value)
  return (
    <div className="card">
      <h2>{title} <span className={'pill ' + (TIER_PILL[tier] || 'grey')} style={{ fontSize: 10 }}>{tier}</span></h2>
      {score?.value != null ? (
        <>
          <div style={{ fontSize: 34, fontWeight: 800, color: `var(--${tone})`, fontVariantNumeric: 'tabular-nums' }}>
            {score.value}<span style={{ fontSize: 14, color: 'var(--mute)' }}>/100</span>
          </div>
          {/* the bar animates between reads, so a moving score is visible at a glance */}
          <div className="bar"><i style={{ width: `${score.value}%`, background: `var(--${tone})` }} /></div>
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{score.note}</div>
        </>
      ) : <div className="empty"><span className="muted">{score?.note || 'no data'}</span></div>}
    </div>
  )
}

export function GovernmentView({ profile, section = 'overview' }) {
  const [segments, setSegments] = useState([])
  const [orgs, setOrgs] = useState([])
  const [segReads, setSegReads] = useState({})
  const [segDrifts, setSegDrifts] = useState({})
  const [loads, setLoads] = useState([])
  const [agent, setAgent] = useState(null)
  const [decision, setDecision] = useState(null)
  const [knowledge, setKnowledge] = useState([])
  const [reviews, setReviews] = useState([])
  const [capturing, setCapturing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const alive = useRef(true)
  const country = profile?.organizations?.country_code

  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  // One pass over the live feeds: AFAI + drift per segment, then the agent.
  const pollFeeds = useCallback(async (segs) => {
    const withCoords = segs.filter(s => s.lat && s.lng)
    if (!withCoords.length) { setUpdatedAt(Date.now()); return }
    setRefreshing(true)
    const reads = {}, drifts = {}
    for (const s of withCoords) {
      const [a, d] = await Promise.all([getAfai(s.lat, s.lng), getDrift(s.lat, s.lng)])
      reads[s.id] = a; drifts[s.id] = d
    }
    if (!alive.current) return
    setSegReads(reads); setSegDrifts(drifts); setUpdatedAt(Date.now()); setRefreshing(false)

    const a = await runAgent({ segments: segs, segReads: reads, hubs: [{ name: 'NEG01', spare_t: 90 }, { name: 'Bloody Bay', spare_t: 60 }] })
    if (alive.current) setAgent(a)
  }, [])

  useEffect(() => {
    let timer
    async function load() {
      // Cross-org reads (RLS 0011 permits Government to see its whole country).
      const [seg, org, ls] = await Promise.all([
        supabase.from('beach_segments').select('*'),
        supabase.from('organizations').select('id, name, role, country_code'),
        supabase.from('load_summaries').select('*'),
      ])
      if (!alive.current) return
      const segs = seg.data ?? []
      setSegments(segs); setOrgs(org.data ?? []); setLoads(ls.data ?? []); setLoading(false)

      await pollFeeds(segs)

      // Keep the picture live — the satellite and current feeds move under us.
      timer = setInterval(() => { if (alive.current) pollFeeds(segs) }, REFRESH_MS)

      const [kn, rv] = await Promise.all([loadKnowledge(), loadReviews()])
      if (alive.current) { setKnowledge(kn); setReviews(rv) }
    }
    load()
    return () => clearInterval(timer)
  }, [pollFeeds])

  async function doCapture() {
    setCapturing(true)
    await runCapture()
    const [kn, rv] = await Promise.all([loadKnowledge(), loadReviews()])
    setKnowledge(kn); setReviews(rv); setCapturing(false)
  }
  async function doDecide(id, state) {
    await decideReview(id, state)
    setReviews(await loadReviews())
  }

  if (loading) return <div className="card"><span className="muted">Loading jurisdiction dashboard…</span></div>

  const scores = computeScores(segReads)
  const landfall = computeLandfall({ segments, reads: segReads, drifts: segDrifts })
  const isAdmin = !!profile?.is_platform_admin
  const S = (sec) => section === sec           // strict: a tab renders only its own panels
  const hotels = orgs.filter(o => o.role === 'hotel').length
  const hubs = orgs.filter(o => o.role === 'recovery_hub').length
  const processors = orgs.filter(o => o.role === 'processor').length
  const recovered = loads.reduce((s, l) => s + Number(l.recovered_t || 0), 0)
  // Carbon exposure (DIRECTIONAL): avoided emissions from what's been recovered.
  const avoidedCO2e = Math.round(recovered * CO2E_PER_T * 10) / 10

  return (
    <div className="dash-grid">
      {S('overview') && <>
      <CoastMap />

      {/* Countdown to the next projected inundation window */}
      <Landfall landfall={landfall} />

      {/* Jurisdiction summary */}
      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          Coast management — {country}
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <LiveDot at={updatedAt} refreshing={refreshing} />
            <button className="btn ghost sm" disabled={refreshing} onClick={() => pollFeeds(segments)}>Refresh</button>
          </span>
        </h2>
        <div className="dash-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))' }}>
          <div><div style={{ fontSize: 26, fontWeight: 800 }}>{segments.length}</div><div className="muted" style={{ fontSize: 12 }}>coast segments</div></div>
          <div><div style={{ fontSize: 26, fontWeight: 800 }}>{hotels}</div><div className="muted" style={{ fontSize: 12 }}>hotels</div></div>
          <div><div style={{ fontSize: 26, fontWeight: 800 }}>{hubs}</div><div className="muted" style={{ fontSize: 12 }}>recovery hubs</div></div>
          <div><div style={{ fontSize: 26, fontWeight: 800 }}>{processors}</div><div className="muted" style={{ fontSize: 12 }}>processors</div></div>
          <div><div style={{ fontSize: 26, fontWeight: 800 }}>{recovered} t</div><div className="muted" style={{ fontSize: 12 }}>recovered</div></div>
        </div>
        {refreshing && <div className="refresh-track"><i /></div>}
      </div>

      {/* Three risk scores — each at its honest tier */}
      <ScoreCard title="Coastal Health Risk" score={scores.coastal_health} />
      <ScoreCard title="Public Health Risk" score={scores.public_health} />
      <ScoreCard title="Carbon Credit Risk" score={scores.carbon_credit} />

      {/* CIIN Agent — orchestrator over grounded live facts, human-gated */}
      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h2>CIIN Agent <span className="pill" style={{ fontSize: 10 }}>{agent?.ai ? 'AI + rules' : 'rules'}</span></h2>
        {!agent ? <div className="empty"><span className="muted">Agent analysing live signals…</span></div>
         : !agent.ok ? <div className="empty"><span className="muted">Agent unavailable{agent.reason ? ` (${agent.reason})` : ''}.</span></div>
         : (
          <>
            {/* named agent contributions, each grounded */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 8, marginBottom: 12 }}>
              {(agent.agents || []).map((a, i) => (
                <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px' }}>
                  <div style={{ fontWeight: 700, fontSize: 12 }}>{a.agent}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{a.says}</div>
                  <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>{a.source}</div>
                </div>
              ))}
            </div>
            {/* recommendation — AI-narrated if a Groq key is set, else deterministic */}
            <div style={{ background: 'var(--panel2, #23292E)', border: '1px solid var(--line)', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 11, letterSpacing: 1, color: 'var(--teal)', textTransform: 'uppercase' }}>
                Recommendation · confidence {agent.confidence}
              </div>
              <div style={{ marginTop: 6, fontSize: 14 }}>{agent.narration || agent.recommendation}</div>
              {agent.ai && <div className="muted" style={{ fontSize: 10, marginTop: 6 }}>AI-reasoned over grounded facts above. Verify against the data; a human decides.</div>}
            </div>
            {/* human-in-the-loop gate */}
            <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {decision ? (
                <span className={'pill ' + (decision === 'approved' ? 'green' : decision === 'rejected' ? 'red' : 'amber')}>
                  {decision === 'approved' ? '✓ Approved & dispatched' : decision === 'rejected' ? '✕ Rejected' : '✎ Sent back to re-plan'}
                </span>
              ) : (
                <>
                  <button className="btn" onClick={() => setDecision('approved')}>Approve &amp; dispatch</button>
                  <button className="btn ghost" onClick={() => setDecision('modified')}>Modify</button>
                  <button className="btn" style={{ background: 'transparent', border: '1px solid var(--red)', color: 'var(--red)' }} onClick={() => setDecision('rejected')}>Reject</button>
                  <span className="muted" style={{ fontSize: 11 }}>The agent proposes; you decide. Nothing dispatches without approval.</span>
                </>
              )}
            </div>
          </>
        )}
      </div>
      </>}

      {S('knowledge') && <>
      {/* Knowledge Hub — cross-org patterns (aggregate, k-anon) + standards audit */}
      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h2>Knowledge Hub <span className="pill" style={{ fontSize: 10 }}>cross-org · aggregate</span>
          <button className="btn ghost sm" style={{ marginLeft: 'auto' }} disabled={capturing} onClick={doCapture}>{capturing ? 'Mining…' : 'Run capture'}</button>
        </h2>
        <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          Patterns the agent finds across organisations (which no single participant can see, by RLS design). Published only as aggregates above a k-anonymity floor — never a single org's record.
        </div>
        {knowledge.length ? knowledge.map(k => (
          <div key={k.id} style={{ padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
            <div style={{ fontSize: 13 }}>{k.headline}</div>
            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
              {k.provenance.replace(/_/g, '-')} · {k.org_count} orgs · {k.sample_n} records
            </div>
          </div>
        )) : <div className="empty"><span className="muted">No cross-org patterns yet. Run capture once there are batches across multiple orgs.</span></div>}

        {reviews.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Standards-audit — proposed rule reviews</div>
            {reviews.map(r => (
              <div key={r.id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 13 }}><b>{r.dimension}{r.band ? ` · band ${r.band}` : ''}</b> <span className={'pill ' + (r.state === 'accepted' ? 'green' : r.state === 'rejected' ? 'red' : 'amber')}>{r.state}</span></div>
                <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{r.finding}</div>
                <div style={{ fontSize: 12, marginTop: 3 }}>Proposal: {r.proposal}</div>
                <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{r.evidence_n} records · {r.org_count} orgs</div>
                {isAdmin && r.state === 'proposed' && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button className="btn sm" onClick={() => doDecide(r.id, 'accepted')}>Accept for review</button>
                    <button className="btn ghost sm" onClick={() => doDecide(r.id, 'rejected')}>Decline</button>
                  </div>
                )}
              </div>
            ))}
            <div className="muted" style={{ fontSize: 11 }}>The agent proposes; a standards owner (Kimberly / platform admin) decides. Accepting flags the rule for review — it does not auto-edit the grading config.</div>
          </div>
        )}
      </div>
      </>}

      {S('carbon') && (
      /* Carbon exposure — directional */
      <div className="card">
        <h2>Carbon exposure <span className="pill amber" style={{ fontSize: 10 }}>directional</span></h2>
        <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--green)' }}>{avoidedCO2e} t</div>
        <div className="muted" style={{ fontSize: 12 }}>CO₂e avoided by in-window recovery across the jurisdiction</div>
        <div className="muted" style={{ fontSize: 11, marginTop: 8, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
          Directional estimate (≈0.30 t CO₂e per tonne wet sargassum cleared before decomposition). Basis for planning; confirmed figures attach on verification.
        </div>
      </div>
      )}

      {S('coast') && <CoastMap />}
      {S('reports') && <RoleReports role="government" profile={profile} />}
    </div>
  )
}
