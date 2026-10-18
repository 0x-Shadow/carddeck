import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/guard";

/**
 * Marketing landing — a server component: no session probing, fully static.
 * The flow it advertises (prompt → outline → generate → export) is exactly
 * what `/new` implements, so the copy stays honest.
 */

const SAMPLE_DECKS = [
  { label: "Product launch", title: "Meet Atlas", cards: ["The problem", "Why now", "Roadmap"] },
  { label: "Quarterly review", title: "Q3 in review", cards: ["Revenue", "Wins", "Next quarter"] },
  { label: "Design critique", title: "Fresh eyes", cards: ["What works", "What slips", "Decisions"] },
];

const STEPS = [
  {
    n: "01",
    title: "Prompt it",
    body: "Describe the deck you need — format, card count, and tone are yours to set.",
  },
  {
    n: "02",
    title: "Shape the outline",
    body: "Edit the AI's outline until every section earns its place.",
  },
  {
    n: "03",
    title: "Generate & refine",
    body: "Cards stream in ready to edit — re-skin the theme or chat to revise any card.",
  },
  {
    n: "04",
    title: "Export .pptx",
    body: "Download a real, editable PowerPoint or a PDF in one click.",
  },
];

export default async function LandingPage() {
  if (await currentUser()) redirect("/dashboard");

  return (
    <main className="home-page">
      <header className="home-header">
        <Link className="home-brand" href="/" aria-label="Carddeck home">
          <span className="home-brand-mark" aria-hidden="true">
            C
          </span>
          Carddeck
        </Link>
        <nav className="home-nav" aria-label="Primary">
          <Link className="home-nav-link" href="/dashboard">
            Projects
          </Link>
          <Link className="home-nav-link" href="/login">
            Sign in
          </Link>
          <Link className="btn-primary" href="/new">
            Create your deck
          </Link>
        </nav>
      </header>

      <section className="home-hero" aria-labelledby="home-title">
        <p className="home-kicker">
          <span aria-hidden="true" /> A workspace for your next big idea
        </p>
        <h1 id="home-title">
          Make your ideas
          <br />
          move people.
        </h1>
        <p className="home-intro">
          Prompt an outline, generate a themed deck card by card, then export a real
          PowerPoint — all in one flow.
        </p>
        <div className="home-cta-row">
          <Link className="btn-primary" href="/new">
            Create your deck
          </Link>
          <Link className="btn-secondary" href="/register">
            Get started free
          </Link>
        </div>
      </section>

      <section className="home-samples" aria-labelledby="samples-title">
        <h2 id="samples-title" className="home-section-title">
          Decks people ship with Carddeck
        </h2>
        <ul className="home-sample-strip">
          {SAMPLE_DECKS.map((deck) => (
            <li className="home-sample" key={deck.label}>
              <p className="home-sample-label">{deck.label}</p>
              <div className="home-sample-slide" aria-hidden="true">
                <span className="home-sample-slide-title">{deck.title}</span>
                {deck.cards.map((card) => (
                  <span className="home-sample-bar" key={card} />
                ))}
              </div>
              <p className="home-sample-caption">{deck.title} + {deck.cards.length} cards</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="home-steps" aria-labelledby="steps-title">
        <h2 id="steps-title" className="home-section-title">
          From prompt to PowerPoint
        </h2>
        <ol className="home-step-list">
          {STEPS.map((step) => (
            <li className="home-step" key={step.n}>
              <span className="home-step-number" aria-hidden="true">
                {step.n}
              </span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="home-final-cta" aria-labelledby="final-cta-title">
        <h2 id="final-cta-title">Your next deck starts with one sentence.</h2>
        <Link className="btn-primary" href="/new">
          Start now
        </Link>
      </section>

      <footer className="home-footer">
        <span>Carddeck</span>
        <span>Clean-room presentation studio</span>
      </footer>
    </main>
  );
}
