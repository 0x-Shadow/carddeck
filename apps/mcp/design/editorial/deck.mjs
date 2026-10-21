/**
 * Reference deck for the Editorial system.
 *
 *   node render.mjs deck.mjs --out ./out
 *
 * The photography is fetched from the Pexels CDN on first run and cached in
 * `.image-cache/`. Swap the URLs (or use local paths) and rewrite the copy;
 * keep the layout rhythm: photo / type / photo / type, one idea per slide.
 */

export default {
  title: "AI in School — The Student Field Guide",
  author: "Carddeck",
  company: "Student Field Guide",
  subject: "What AI changes, what it costs, and how students should use it",
  footer: { left: "AI & the New School System", right: "Student field guide · 2026" },

  images: {
    cover: "https://images.pexels.com/photos/5212345/pexels-photo-5212345.jpeg?auto=compress&cs=tinysrgb&w=2600",
    shift: "https://images.pexels.com/photos/5212340/pexels-photo-5212340.jpeg?auto=compress&cs=tinysrgb&w=2600",
    pace: "https://images.pexels.com/photos/4144920/pexels-photo-4144920.jpeg?auto=compress&cs=tinysrgb&w=2600",
    feedback: "https://images.pexels.com/photos/5905709/pexels-photo-5905709.jpeg?auto=compress&cs=tinysrgb&w=2600",
    access: "https://images.pexels.com/photos/3401403/pexels-photo-3401403.jpeg?auto=compress&cs=tinysrgb&w=2600",
    teachers: "https://images.pexels.com/photos/8197530/pexels-photo-8197530.jpeg?auto=compress&cs=tinysrgb&w=2600",
    risks: "https://images.pexels.com/photos/267507/pexels-photo-267507.jpeg?auto=compress&cs=tinysrgb&w=2600",
    quote: "https://images.pexels.com/photos/5212322/pexels-photo-5212322.jpeg?auto=compress&cs=tinysrgb&w=2600",
    close: "https://images.pexels.com/photos/3182773/pexels-photo-3182773.jpeg?auto=compress&cs=tinysrgb&w=2600",
  },

  slides: [
    {
      layout: "cover",
      image: "cover",
      pos: "64% 33%",
      kicker: "Student field guide · 2026",
      title: [{ t: "AI IN SCHOOL" }, { t: "IS ALREADY", accent: true }, { t: "HERE." }],
      lede: "The question isn't whether it belongs in your classroom. It's whether it makes you sharper — or just faster.",
      notes:
        "AI is already in the building. This deck is not about whether to allow it — it is about how to use it so it makes you stronger, not just faster.",
    },
    {
      layout: "split",
      tone: "bone",
      side: "right",
      imgW: 760,
      gap: 100,
      image: "shift",
      pos: "56% 42%",
      top: 196,
      size: 88,
      kicker: "The shift",
      title: [{ t: "Thirty years of school." }, { t: "Three years of", muted: true }, { t: "everything else." }],
      body: [
        "One teacher, thirty students, one pace — that was the model for a century. Generative AI broke it in a single news cycle.",
        "Every student can now have a tutor that never sleeps, never judges, and never runs out of patience.",
      ],
      bodyWidth: 840,
      bodySize: 27,
      stat: { value: "3", label: "<b>years</b> to rewrite<br>a century-old model." },
      statSize: 150,
      statTop: 46,
      foot: { left: "AI & the New School System", right: "02 · The shift" },
      notes:
        "The classroom model was stable for a century. In three years, generative AI changed what 'having a tutor' means.",
    },
    {
      layout: "statement",
      kicker: "What it actually is",
      title: [{ t: "Not a magic box." }, { t: "A very patient tutor.", muted: true }],
      columns: [
        {
          n: "01",
          label: "It explains.",
          text: "The same idea, five different ways, until one lands. No sighing. No clock. No fear of asking twice.",
        },
        {
          n: "02",
          label: "It critiques.",
          text: "It reads your draft like a picky editor — structure, clarity, argument, evidence — and tells you where it sags.",
        },
        {
          n: "03",
          label: "It drills.",
          text: "Flashcards, practice exams, summaries, schedules: the boring work that makes knowledge actually stick.",
        },
      ],
      close: "And it is never the author. You are.",
      foot: { left: "What it actually is", right: "03 · Definitions" },
      notes:
        "Three jobs: explain, critique, drill. The last line matters most — the tool never owns the work.",
    },
    {
      layout: "split",
      tone: "bone",
      image: "pace",
      imgW: 740,
      pos: "54% 40%",
      top: 186,
      size: 96,
      kicker: "Benefit 01 · Pace",
      title: [{ t: "Your pace," }, { t: "not the class's." }],
      body: ["AI finds the exact gap in your understanding, drills that, and moves on the moment you're ready."],
      bodyWidth: 900,
      rows: [
        { t: "Fast students stop waiting for the room.", s: "No more three-week detours through material you already know." },
        { t: "The back row stops disappearing.", s: "Ask the same question nine times. It never gets tired of you." },
        { t: "Nobody has to admit they're lost.", s: "The most useful questions are the ones you'd never ask out loud." },
      ],
      rowsTop: 46,
      foot: { left: "AI & the New School System", right: "04 · Pace" },
      notes: "Personalization was always promised; now it is nearly free. Pace is the first thing it fixes.",
    },
    {
      layout: "split",
      tone: "ink",
      side: "left",
      imgW: 880,
      gap: 120,
      image: "feedback",
      pos: "50% 44%",
      top: 186,
      size: 96,
      kicker: "Benefit 02 · Feedback",
      title: [{ t: "Seconds," }, { t: "not Sundays." }],
      pairs: [
        {
          label: "OLD LOOP",
          text: "Hand in. Wait a week. Get a grade. Never read it again.",
          dim: true,
          strike: true,
        },
        {
          label: "NEW LOOP",
          text: "Try. Get feedback. Fix it. Try again — ten times before the deadline.",
          accent: true,
        },
      ],
      stat: {
        value: "10×",
        label: "more repetitions with guidance.<br>That's where learning actually happens.",
      },
      statSize: 150,
      foot: { left: "AI & the New School System", right: "05 · Feedback" },
      notes:
        "The old loop gives you one grade after a week. The new loop gives you ten guided attempts before the deadline.",
    },
    {
      layout: "band",
      tone: "bone",
      image: "access",
      pos: "50% 38%",
      kicker: "Benefit 03 · Access",
      title: [{ t: "A private tutor" }, { t: "for everyone." }],
      lede: "The best tutors used to cost more than tuition. The best AI tutors are free — and the gap between schools stops being a gap in tools.",
      items: [
        { t: "Cost", s: "The same tools in every ZIP code, on every phone." },
        { t: "Language", s: "Instant translation, better drafts, real explanations in your first language." },
        { t: "Disability", s: "Dyslexia, ADHD, low vision: support built in, not bolted on." },
        { t: "Funding", s: "Underfunded schools inherit the same tutors as elite ones." },
      ],
      foot: { left: "Benefit 03 · Access", right: "06 · Equity" },
      notes:
        "Access is the quiet superpower: the same tutor for the private-school kid and the kid on a shared laptop.",
    },
    {
      layout: "split",
      tone: "ink",
      side: "left",
      imgW: 900,
      gap: 120,
      image: "teachers",
      pos: "46% 40%",
      top: 186,
      size: 92,
      kicker: "Benefit 04 · Teachers",
      title: [{ t: "Teachers get" }, { t: "their time back." }],
      body: [
        "AI drafts lesson plans, writes practice sets, and handles the first pass of grading.",
        "That buys back the one thing only a human can give: attention.",
      ],
      bodySize: 24,
      quote: "“The teacher's job was never to be the fastest calculator in the room.”",
      quoteTop: 44,
      quoteSize: 34,
      stat: { value: "6 hrs", label: "a week handed back<br>to actual teaching." },
      statSize: 104,
      statLabelSize: 18,
      statTop: 40,
      foot: { left: "AI & the New School System", right: "07 · Teachers" },
      notes:
        "AI takes the busywork, not the relationship. The hours go back into mentoring, noticing, and motivating.",
    },
    {
      layout: "fullBleedList",
      image: "risks",
      pos: "50% 50%",
      kicker: "The honest part",
      mutedColor: "rgba(242,238,228,.72)",
      title: [{ t: "The part nobody" }, { t: "puts on a poster.", muted: true }],
      items: [
        {
          t: "Hollow learning.",
          s: "An answer you can't explain is just a more polished way to fail. Teachers can hear it in your voice.",
        },
        {
          t: "Confident lies.",
          s: "It invents facts with total conviction. Check every number, date and quotation against a real source.",
        },
        {
          t: "A weaker muscle.",
          s: "Skip the struggle and your problem-solving quietly atrophies. Friction is the workout.",
        },
        {
          t: "Privacy & bias.",
          s: "Never paste personal data. It inherits the internet's blind spots — and repeats them politely.",
        },
      ],
      close: "Every one of these is avoidable — if you know the method.",
      foot: { left: "The honest part", right: "08 · Risks" },
      notes:
        "Four risks worth naming out loud: hollow understanding, hallucinations, atrophied thinking, and privacy or bias.",
    },
    {
      layout: "steps",
      kicker: "The method",
      title: [{ t: "Four steps." }, { t: "Every subject." }],
      items: [
        {
          t: "Explain it back.",
          s: "Ask for a walkthrough, then say it in your own words. If you can't, you don't have it yet.",
        },
        {
          t: "Struggle first.",
          s: "Attempt the problem before you ask. Then ask for a hint — never the answer.",
        },
        {
          t: "Verify the claim.",
          s: "Textbook, notes, a second source. If you can't verify it, you can't cite it.",
        },
        {
          t: "Rewrite it.",
          s: "Close the tab and write it yourself. That small gap is where the learning lives.",
        },
      ],
      close: "The order matters. Skip step two and none of it sticks.",
      aside: "EXPLAIN → VERIFY → REWRITE",
      foot: { left: "The method", right: "09 · Method" },
      notes:
        "The order is the method. Struggle before help, verify before citation, rewrite before submission.",
    },
    {
      layout: "cards",
      kicker: "Playbook",
      title: [{ t: "Prompts that" }, { t: "actually work.", muted: true }],
      items: [
        { label: "STUCK", prompt: "Explain it like I'm 12, then quiz me until I get five in a row." },
        { label: "EXAM WEEK", prompt: "Turn these notes into 20 flashcards and one timed practice test." },
        { label: "ESSAY DUE", prompt: "Critique my thesis and outline. Do not rewrite my sentences." },
        { label: "MATH", prompt: "Give me a hint for the next step — not the solution." },
      ],
      foot: { left: "Playbook", right: "10 · Prompts" },
      notes:
        "Four prompts students can use tonight. The pattern: ask for coaching, never for the finished product.",
    },
    {
      layout: "manifesto",
      kicker: "Integrity",
      title: [{ t: "Your name" }, { t: "is on it." }],
      lede: "Every school's AI policy is different — and most are less than two years old. Read yours before the next deadline, not after.",
      rules: [
        "Never submit AI text as your own. That is plagiarism, and it is increasingly detectable.",
        "Disclose when it matters: <i>“Assisted by AI, reviewed and rewritten by me.”</i>",
        "Use it as a coach, never as a ghostwriter.",
      ],
      sticker: "coach\n≠\nghostwriter",
      foot: { left: "Integrity", right: "11 · Integrity" },
      notes:
        "Integrity is not a technicality. The signature is yours, and disclosure is a strength, not a confession.",
    },
    {
      layout: "rows",
      kicker: "What still belongs to you",
      title: [{ t: "The human layer." }],
      items: [
        {
          word: "Judgment.",
          text: "AI gives answers. You decide which ones are true, which are useful, and which are nonsense.",
        },
        { word: "Questions.", text: "A better prompt is just a better question. Curiosity is the new literacy." },
        {
          word: "Taste.",
          text: "Knowing good work from mediocre work. No model wants anything for you — that's still your job.",
        },
        {
          word: "Grit.",
          text: "The willingness to sit with a hard problem longer than is comfortable. That's where the edge is.",
        },
      ],
      foot: { left: "The human layer", right: "12 · Skills" },
      notes: "The tool keeps getting better. The differentiator is judgment, questions, taste, and grit.",
    },
    {
      layout: "quote",
      image: "quote",
      pos: "58% 34%",
      lines: ["The advantage was never the tool.", "It's who bothers to learn", "how to use it."],
      caption: "THE ONLY LINE THAT MATTERS",
      foot: { left: "AI & the New School System", right: "13 · Quote" },
      notes:
        "The tool is table stakes. The advantage is the student who learns how to use it deliberately.",
    },
    {
      layout: "close",
      image: "close",
      pos: "50% 46%",
      kicker: "Your move",
      title: [{ t: "Start with" }, { t: "one class.", accent: true }],
      body: "One subject. One tool. One habit: explain it, verify it, rewrite it in your own words.",
      close: "AI won't replace students. Students who learn with it will outpace students who don't.",
      foot: { left: "AI & the New School System", right: "14 · Close" },
      notes:
        "Close with a single commitment: one class, one tool, one habit. That is how adoption actually starts.",
    },
  ],
};
