/**
 * Header for read-only views (public reader and present mode): deck title,
 * author byline, and an optional action slot (exit button, share, …) kept
 * deliberately separate from the card so chrome never prints on a slide.
 */
export interface ReaderChromeProps {
  title: string;
  author?: string | null;
  children?: React.ReactNode;
}

export function ReaderChrome({ title, author, children }: ReaderChromeProps) {
  return (
    <header className="reader-chrome">
      <div className="reader-chrome-text">
        <h1 className="reader-chrome-title">{title}</h1>
        {author ? <p className="reader-chrome-author">by {author}</p> : null}
      </div>
      {children ? <div className="reader-chrome-actions">{children}</div> : null}
    </header>
  );
}
