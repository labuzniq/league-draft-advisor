// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { Waiting } from "./Waiting";

afterEach(cleanup);

test("explains when champion data could not be loaded", () => {
  render(<Waiting reason="no-data" />);
  expect(screen.getByText("Champion data could not be loaded. Check your internet connection.")).toBeDefined();
});

test("explains when champion select could not be read", () => {
  render(<Waiting reason="unreadable" />);
  expect(screen.getByText("Champion select could not be read. The League client may have changed.")).toBeDefined();
});
