"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";

export default function HomePage() {
  const router = useRouter();

  function openDeck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const deckId = String(formData.get("deckId") ?? "").trim();
    if (deckId) router.push(`/deck/${encodeURIComponent(deckId)}`);
  }

  return (
    <main className="home-page">
      <header className="home-header">
        <a className="home-brand" href="/" aria-label="Carddeck home">
          <span className="home-brand-mark" aria-hidden="true">C</span>
          Carddeck
        </a>
        <span className="home-edition">PRESENTATION STUDIO</span>
      </header>

      <section className="home-hero" aria-labelledby="home-title">
        <p className="home-kicker"><span aria-hidden="true" /> A workspace for your next big idea</p>
        <h1 id="home-title">Make your ideas<br />move people.</h1>
        <p className="home-intro">
          Turn a clear thought into a deck you can shape, present, and share.
        </p>

        <form className="home-open-form" onSubmit={openDeck}>
          <label htmlFor="deck-id">Open an existing deck</label>
          <div className="home-input-row">
            <input
              id="deck-id"
              name="deckId"
              type="text"
              placeholder="Enter deck ID"
              autoComplete="off"
              required
            />
            <button type="submit">Open deck <span aria-hidden="true">↗</span></button>
          </div>
          <p className="home-form-note">Use the deck ID from its editor URL.</p>
        </form>
      </section>

      <footer className="home-footer">
        <span>Ideas, made tangible.</span>
        <span>EDIT · PRESENT · SHARE</span>
      </footer>
    </main>
  );
}