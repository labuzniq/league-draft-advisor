// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { Setup } from "./Setup";

afterEach(cleanup);

test("saving sends the key", async () => {
  const setApiKey = vi.fn(async () => {});
  render(<Setup setApiKey={setApiKey} />);
  await userEvent.type(screen.getByLabelText("Claude API key"), "sk-ant-test");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(setApiKey).toHaveBeenCalledWith("sk-ant-test");
});

test("a failed save shows the error message", async () => {
  const setApiKey = vi.fn(async () => {
    throw new Error("This computer cannot store the key safely.");
  });
  render(<Setup setApiKey={setApiKey} />);
  await userEvent.type(screen.getByLabelText("Claude API key"), "sk-ant-test");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("This computer cannot store the key safely.")).toBeDefined();
});
