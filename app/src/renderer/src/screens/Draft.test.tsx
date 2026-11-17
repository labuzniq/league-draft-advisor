// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { AppView } from "../../../shared/types";
import { Draft } from "./Draft";

type DraftView = Extract<AppView, { screen: "draft" }>;

const base: DraftView = {
  screen: "draft",
  patch: "15.22",
  statsMissing: false,
  role: "middle",
  myTurn: true,
  allies: [{ name: "Jarvan IV", imageUrl: "jarvan.png", role: "jungle" }],
  enemies: [{ name: "Ahri", imageUrl: "ahri.png" }],
  advice: { status: "idle" },
};

const orianna = { name: "Orianna", imageUrl: "orianna.png", winRate: 0.521 };
const reason = "Her ball follows Jarvan IV into fights.";

afterEach(cleanup);

function renderDraft(advice: DraftView["advice"], overrides: Partial<DraftView> = {}) {
  const chooseRole = vi.fn();
  const retry = vi.fn();
  render(<Draft view={{ ...base, ...overrides, advice }} chooseRole={chooseRole} retry={retry} />);
  return { chooseRole, retry };
}

test("a ready view shows the picks with win rate and reason", () => {
  renderDraft({ status: "ready", teamRead: "Jarvan IV brings engage.", picks: [{ ...orianna, reason }] });
  expect(screen.getByText("Orianna")).toBeDefined();
  expect(screen.getByText("52.1% win rate")).toBeDefined();
  expect(screen.getByText(reason)).toBeDefined();
  expect(screen.getByText("Jarvan IV brings engage.")).toBeDefined();
  expect(screen.getByText("Your pick")).toBeDefined();
  expect(screen.getByText("Patch 15.22")).toBeDefined();
});

test("a need-role view asks for the role", async () => {
  const { chooseRole } = renderDraft({ status: "need-role" }, { role: undefined });
  await userEvent.selectOptions(screen.getByRole("combobox"), "Mid");
  expect(chooseRole).toHaveBeenCalledWith("middle");
});

test("an error view shows the message, a Retry button and picks by statistics", async () => {
  const { retry } = renderDraft({ status: "error", message: "Claude is busy right now. Try again in a moment.", picks: [orianna] });
  expect(screen.getByText("Claude is busy right now. Try again in a moment.")).toBeDefined();
  expect(screen.getByRole("heading", { name: "Strong picks by statistics" })).toBeDefined();
  expect(screen.getByText("Orianna")).toBeDefined();
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalledOnce();
});

test("a loading view shows the picks so far and a thinking line", () => {
  renderDraft({ status: "loading", picks: [{ ...orianna, reason }] });
  expect(screen.getByText("Orianna")).toBeDefined();
  expect(screen.getByText("Thinking…")).toBeDefined();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
});

test("missing statistics are explained", () => {
  renderDraft({ status: "idle" }, { statsMissing: true, patch: undefined });
  expect(screen.getByText("Statistics are not available. Suggestions use game knowledge only.")).toBeDefined();
});
