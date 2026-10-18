// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ReaderCard } from "../components/reader/ReaderCard";
import { ReaderChrome } from "../components/reader/ReaderChrome";
import { PresentStage } from "../components/reader/PresentStage";
import type { Theme } from "@carddeck/core";

afterEach(() => cleanup());

const theme: Theme = {
  id: "th1",
  name: "Test",
  isPreset: true,
  fonts: { display: "Georgia", body: "Verdana" },
  colors: {
    page: "#101828",
    surface: "#1d2939",
    ink: "#f2f4f7",
    muted: "#98a2b3",
    accent: "#f97316",
  },
  radius: "8px",
  shadow: "none",
};

const slide = (position: number, title: string) => ({
  id: `c${position}`,
  title,
  blocks: JSON.stringify([{ type: "heading", level: 2, text: [`${title} heading`] }]),
});

describe("ReaderCard", () => {
  it("renders the card title and its blocks with the theme's CSS vars", () => {
    render(<ReaderCard card={slide(0, "Quarterly Plan")} theme={theme} index={1} total={2} />);
    expect(screen.getByRole("heading", { name: "Quarterly Plan" })).toBeTruthy();
    expect(screen.getByText("Quarterly Plan heading")).toBeTruthy();
    const section = document.querySelector(".reader-card") as HTMLElement;
    expect(section.style.getPropertyValue("--page")).toBe("#101828");
    expect(section.querySelector("[data-block=heading]")).toBeTruthy();
  });

  it("renders a pending card's title without crashing on empty blocks", () => {
    render(
      <ReaderCard
        card={{ title: "Later", blocks: "[]" }}
        theme={theme}
      />
    );
    expect(screen.getByRole("heading", { name: "Later" })).toBeTruthy();
  });
});

describe("ReaderChrome", () => {
  it("shows the title and author, plus action slots", () => {
    render(
      <ReaderChrome title="Shared Deck" author="Ada">
        <button type="button">Exit</button>
      </ReaderChrome>,
    );
    expect(screen.getByRole("heading", { name: "Shared Deck" })).toBeTruthy();
    expect(screen.getByText("by Ada")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Exit" })).toBeTruthy();
  });
});

describe("PresentStage", () => {
  const three = [slide(0, "Cover"), slide(1, "Body"), slide(2, "Wrap")];

  it("starts on the first card and advances with ArrowRight", () => {
    render(
      <PresentStage deckTitle="Present Me" cards={three} theme={theme} onExit={vi.fn()} />,
    );
    expect(screen.getByRole("heading", { name: "Cover" })).toBeTruthy();
    expect(screen.getByText("1 / 3")).toBeTruthy();

    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(screen.getByRole("heading", { name: "Body" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Cover" })).toBeNull();
    expect(screen.getByText("2 / 3")).toBeTruthy();
  });

  it("does not go before the first or past the last card", () => {
    render(
      <PresentStage deckTitle="Present Me" cards={three} theme={theme} onExit={vi.fn()} />,
    );
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(screen.getByText("1 / 3")).toBeTruthy();

    for (let i = 0; i < 10; i += 1) fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(screen.getByText("3 / 3")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Wrap" })).toBeTruthy();
  });

  it("exits via the onExit callback on Escape", () => {
    const onExit = vi.fn();
    render(<PresentStage deckTitle="P" cards={three} theme={theme} onExit={onExit} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("advertises progress to assistive tech and advances via the Next button", () => {
    render(
      <PresentStage deckTitle="P" cards={three} theme={theme} onExit={vi.fn()} />,
    );
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByText("2 / 3")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("2");
    expect(screen.getByRole("button", { name: /previous/i })).toHaveProperty("disabled", false);
  });
});
