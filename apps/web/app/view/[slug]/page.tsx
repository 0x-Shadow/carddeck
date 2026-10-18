import { notFound } from "next/navigation";
import { ReaderCard } from "@/components/reader/ReaderCard";
import { ReaderChrome } from "@/components/reader/ReaderChrome";
import { deckCssVars } from "@/lib/themes-presets";
import { getPublicDeck } from "@/lib/public-deck";

/**
 * Public reader for a shared deck (`/view/[slug]`).
 *
 * A server component: `await params` + `getPublicDeck` read the database
 * directly, so the page ships zero client JS and can't flicker through a
 * loading state. There is nothing interactive here — present mode and the
 * editor are separate, owner-gated routes. An unknown or unshared slug is a
 * plain 404 (`notFound()`), not a 200 page that lies about being a deck.
 */
export default async function ViewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await getPublicDeck(slug);

  if (!data) notFound();

  return (
    <main className="reader-page" style={deckCssVars(data.theme)}>
      <ReaderChrome title={data.title} author={data.author} />
      <div className="reader-stack">
        {data.cards.map((c, i) => (
          <ReaderCard
            key={c.id}
            card={c}
            theme={data.theme}
            index={i + 1}
            total={data.cards.length}
          />
        ))}
      </div>
    </main>
  );
}
