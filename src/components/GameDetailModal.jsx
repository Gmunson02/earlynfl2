import { useEffect, useState } from "react";
import Image from "next/image";
import { X } from "lucide-react";

const HEADLINE_STATS = [
  { name: "totalYards", label: "Total Yards" },
  { name: "turnovers", label: "Turnovers" },
  { name: "possessionTime", label: "Possession" },
];

export default function GameDetailModal({
  eventId,
  awayTeam,
  homeTeam,
  onClose,
  isLive,
  period,
  clock,
  possessionTeamId,
  downDistanceText,
  yardLineText,
  broadcast,
}) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Don't let the page scroll behind the modal
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetch(`/api/gamesummary?event=${eventId}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const competitors = summary?.header?.competitions?.[0]?.competitors || [];
  const awayComp = competitors.find((c) => c.homeAway === "away");
  const homeComp = competitors.find((c) => c.homeAway === "home");

  const boxTeams = summary?.boxscore?.teams || [];
  const statFor = (homeAway, statName) => {
    const team = boxTeams.find((t) => t.homeAway === homeAway);
    return team?.statistics?.find((s) => s.name === statName)?.displayValue ?? "—";
  };

  const scoringPlays = Array.isArray(summary?.scoringPlays) ? summary.scoringPlays : [];

  const possessingAbbr =
    possessionTeamId && String(possessionTeamId) === String(awayTeam.id)
      ? awayTeam.abbr
      : possessionTeamId && String(possessionTeamId) === String(homeTeam.id)
      ? homeTeam.abbr
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-zinc-900 rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-700 px-4 py-3 flex items-center justify-between">
          <h2 className="font-bold">
            {awayTeam.abbr} @ {homeTeam.abbr}
            {broadcast && <span className="font-medium text-zinc-500"> ({broadcast})</span>}
          </h2>
          <button onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <p className="p-6 text-center text-zinc-500">Loading…</p>
        ) : error || !summary ? (
          <p className="p-6 text-center text-zinc-500">Couldn&apos;t load game details.</p>
        ) : (
          <div className="p-4 space-y-5">
            {/* Live status: quarter/clock + who has the ball + down & distance */}
            {isLive && (
              <div className="text-center text-sm font-semibold text-zinc-700 dark:text-zinc-200 bg-zinc-100 dark:bg-zinc-800 rounded-lg py-2">
                Q{period} {clock}
                {(downDistanceText || yardLineText) && (
                  <>
                    {" | "}
                    {possessingAbbr && `${possessingAbbr} `}
                    {downDistanceText}
                    {downDistanceText && yardLineText ? " on " : ""}
                    {yardLineText}
                  </>
                )}
              </div>
            )}

            {/* Linescore */}
            {(awayComp?.linescores?.length || homeComp?.linescores?.length) ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-center border-collapse">
                  <thead>
                    <tr className="text-zinc-500">
                      <th className="text-left font-medium pb-1"> </th>
                      {(awayComp?.linescores || homeComp?.linescores || []).map((_, i) => (
                        <th key={i} className="font-medium pb-1">
                          Q{i + 1}
                        </th>
                      ))}
                      <th className="font-bold pb-1">T</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { comp: awayComp, team: awayTeam },
                      { comp: homeComp, team: homeTeam },
                    ].map(({ comp, team }) => (
                      <tr key={team.abbr} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="text-left py-1 font-semibold flex items-center gap-1.5">
                          {team.logo && <Image src={team.logo} alt={team.abbr} width={18} height={18} />}
                          {team.abbr}
                          {isLive && possessionTeamId && String(team.id) === String(possessionTeamId) && (
                            <span className="text-xs" title="Has possession">
                              🏈
                            </span>
                          )}
                        </td>
                        {(comp?.linescores || []).map((ls, i) => (
                          <td key={i} className="py-1">
                            {ls.displayValue}
                          </td>
                        ))}
                        <td className="py-1 font-bold">{comp?.score ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {/* Headline stats */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">Team Stats</h3>
              <div className="space-y-1.5">
                {HEADLINE_STATS.map((stat) => (
                  <div key={stat.name} className="flex items-center justify-between text-sm">
                    <span className="w-16 text-right font-semibold">{statFor("away", stat.name)}</span>
                    <span className="flex-1 text-center text-zinc-500 text-xs">{stat.label}</span>
                    <span className="w-16 text-left font-semibold">{statFor("home", stat.name)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Scoring plays */}
            {scoringPlays.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">Scoring Plays</h3>
                <ul className="space-y-2">
                  {scoringPlays.map((play) => (
                    <li key={play.id} className="text-sm flex items-start gap-2">
                      {play.team?.logo && (
                        <Image src={play.team.logo} alt={play.team.abbreviation} width={16} height={16} className="mt-0.5 shrink-0" />
                      )}
                      <div>
                        <span className="text-zinc-500 text-xs">
                          Q{play.period?.number} {play.clock?.displayValue} — {play.scoringType?.displayName}
                        </span>
                        <p>{play.text}</p>
                      </div>
                      <span className="ml-auto text-xs font-mono text-zinc-500 shrink-0">
                        {play.awayScore}-{play.homeScore}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
