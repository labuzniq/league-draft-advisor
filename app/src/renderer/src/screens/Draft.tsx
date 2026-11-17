import { ROLES, type Role } from "@lda/shared";
import type { AppView, ChampionChip, PickRow } from "../../../shared/types";

type DraftView = Extract<AppView, { screen: "draft" }>;

const ROLE_LABELS: Record<Role, string> = { top: "Top", jungle: "Jungle", middle: "Mid", bottom: "Bot", utility: "Support" };

function Chips({ title, chips }: { title: string; chips: ChampionChip[] }) {
  return (
    <section className="team">
      <h3>{title}</h3>
      <ul className="chips">
        {chips.map((chip, index) => (
          <li key={index} className="chip">
            {chip.imageUrl && <img src={chip.imageUrl} alt="" />}
            <span>{chip.name}</span>
            {chip.role && <span className="muted">{ROLE_LABELS[chip.role]}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Picks({ picks }: { picks: PickRow[] }) {
  return (
    <ul className="picks">
      {picks.map((pick, index) => (
        <li key={index} className="pick">
          {pick.imageUrl && <img src={pick.imageUrl} alt="" />}
          <div>
            <div className="pick-title">
              <strong>{pick.name}</strong>
              {pick.winRate !== undefined && <span className="muted">{(pick.winRate * 100).toFixed(1)}% win rate</span>}
            </div>
            {pick.reason && <p>{pick.reason}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Advice({ advice, chooseRole, retry }: { advice: DraftView["advice"]; chooseRole: (role: Role) => void; retry: () => void }) {
  switch (advice.status) {
    case "idle":
      return null;
    case "need-role":
      return (
        <label className="field">
          Which role are you playing?
          <select defaultValue="" onChange={(event) => chooseRole(event.target.value as Role)}>
            <option value="" disabled>
              Choose a role
            </option>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </label>
      );
    case "loading":
    case "ready":
      return (
        <>
          {advice.teamRead && <p className="team-read">{advice.teamRead}</p>}
          <Picks picks={advice.picks} />
          {advice.status === "loading" && <p className="muted">Thinking…</p>}
        </>
      );
    case "error":
      return (
        <>
          <p className="error">{advice.message}</p>
          <button onClick={retry}>Retry</button>
          <h3>Strong picks by statistics</h3>
          <Picks picks={advice.picks} />
        </>
      );
  }
}

export function Draft({ view, chooseRole, retry }: { view: DraftView; chooseRole: (role: Role) => void; retry: () => void }) {
  return (
    <main className="draft">
      <header className="draft-header">
        {view.patch && <span>Patch {view.patch}</span>}
        {view.role && <span>{ROLE_LABELS[view.role]}</span>}
        {view.myTurn && <strong className="your-pick">Your pick</strong>}
      </header>
      {view.statsMissing && <p className="muted">Statistics are not available. Suggestions use game knowledge only.</p>}
      <Chips title="Allies" chips={view.allies} />
      <Chips title="Enemies" chips={view.enemies} />
      <Advice advice={view.advice} chooseRole={chooseRole} retry={retry} />
    </main>
  );
}
