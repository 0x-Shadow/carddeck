/**
 * Curated online photography and 3D visual library for presentations.
 *
 * Uses direct Unsplash image URLs optimized with query parameters
 * (`auto=format&fit=crop&w=1600&q=80`). These images load reliably in browsers,
 * download quickly in the PDF exporter, and embed as real pictures into PPTX.
 */

export interface ThematicImage {
  src: string;
  caption: string;
  category: "3d" | "ai" | "business" | "data" | "finance" | "nature" | "creative" | "minimal";
}

export const CURATED_ONLINE_IMAGES: ThematicImage[] = [
  // 3D abstract & glass geometry
  {
    src: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1600&q=80",
    caption: "3D abstract fluid glass geometry",
    category: "3d",
  },
  {
    src: "https://images.unsplash.com/photo-1634017839464-5c339ebe3cb4?auto=format&fit=crop&w=1600&q=80",
    caption: "3D chromatic torus and floating spheres",
    category: "3d",
  },
  {
    src: "https://images.unsplash.com/photo-1633493106115-f5b244d564e9?auto=format&fit=crop&w=1600&q=80",
    caption: "Futuristic isometric architectural shapes",
    category: "3d",
  },
  {
    src: "https://images.unsplash.com/photo-1617791160505-6f00504e3519?auto=format&fit=crop&w=1600&q=80",
    caption: "Dimensional iridescent wave patterns",
    category: "3d",
  },

  // AI & technology
  {
    src: "https://images.unsplash.com/photo-1677442136019-21780ecad995?auto=format&fit=crop&w=1600&q=80",
    caption: "Neural network intelligence matrix",
    category: "ai",
  },
  {
    src: "https://images.unsplash.com/photo-1620712943543-bcc4688e7485?auto=format&fit=crop&w=1600&q=80",
    caption: "Cybernetic glowing AI neural nodes",
    category: "ai",
  },
  {
    src: "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=1600&q=80",
    caption: "Digital encrypted code matrix",
    category: "ai",
  },
  {
    src: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1600&q=80",
    caption: "Microprocessor circuitry and quantum processor",
    category: "ai",
  },

  // Business & Strategy
  {
    src: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1600&q=80",
    caption: "Modern corporate skyscraper glass facade",
    category: "business",
  },
  {
    src: "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1600&q=80",
    caption: "Executive conference boardroom interior",
    category: "business",
  },
  {
    src: "https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=1600&q=80",
    caption: "Global leadership and strategic execution",
    category: "business",
  },

  // Data & Analytics
  {
    src: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1600&q=80",
    caption: "Real-time analytics and growth dashboard",
    category: "data",
  },
  {
    src: "https://images.unsplash.com/photo-1504868584819-f8e8b4b6d7e3?auto=format&fit=crop&w=1600&q=80",
    caption: "Holographic telemetry and performance data",
    category: "data",
  },
  {
    src: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1600&q=80",
    caption: "Quantitative metrics and market intelligence",
    category: "data",
  },

  // Finance & Markets
  {
    src: "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=1600&q=80",
    caption: "Algorithmic capital market dynamics",
    category: "finance",
  },
  {
    src: "https://images.unsplash.com/photo-1559526324-4b87b5e36e44?auto=format&fit=crop&w=1600&q=80",
    caption: "Venture capital and enterprise growth",
    category: "finance",
  },

  // Nature & Landscape
  {
    src: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1600&q=80",
    caption: "Alpine mountain peaks reflecting across water",
    category: "nature",
  },
  {
    src: "https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=1600&q=80",
    caption: "Emerald mist rising through ancient pine forest",
    category: "nature",
  },

  // Creative & Design
  {
    src: "https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?auto=format&fit=crop&w=1600&q=80",
    caption: "Minimalist creative studio and digital product design",
    category: "creative",
  },
  {
    src: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=1600&q=80",
    caption: "Vibrant retro-futuristic digital aesthetics",
    category: "creative",
  },

  // Minimal & Textures
  {
    src: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1600&q=80",
    caption: "Golden hour coastal horizon and clean lines",
    category: "minimal",
  },
  {
    src: "https://images.unsplash.com/photo-1513542789411-b6a5d4f31634?auto=format&fit=crop&w=1600&q=80",
    caption: "Soft ambient architectural gradients",
    category: "minimal",
  },
];

/** Simple string hash (FNV-1a) for deterministic matching. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Detect the most appropriate image category based on prompt keywords.
 */
export function detectCategory(text: string): ThematicImage["category"] {
  const lower = text.toLowerCase();
  if (lower.match(/\b(3d|render|dimension|cube|geometry|virtual|vr|ar|isometric)\b/)) return "3d";
  if (lower.match(/\b(finance|financial|revenue|arr|mrr|invest|investor|capital|funding|bank|crypto|money|sales|valuation)\b/)) return "finance";
  if (lower.match(/\b(ai|artificial|model|agent|neural|machine learning|robot|tech|software|code|cyber)\b/)) return "ai";
  if (lower.match(/\b(data|metric|analytics|chart|graph|stats|kpi|telemetry|trend)\b/)) return "data";
  if (lower.match(/\b(green|nature|sustain|climate|forest|ocean|eco|earth|outdoor)\b/)) return "nature";
  if (lower.match(/\b(design|creative|art|brand|style|ui|ux|craft|studio)\b/)) return "creative";
  if (lower.match(/\b(simple|clean|zen|minimal|calm|quiet)\b/)) return "minimal";
  return "business";
}

/**
 * Select a curated online image matching the topic and card position.
 */
export function getThematicOnlineImage(
  topic: string,
  index = 0,
  layout: "full" | "side" | "behind" = "full",
): { type: "image"; src: string; caption: string; layout: "full" | "side" | "behind" } {
  const category = detectCategory(topic);
  const matches = CURATED_ONLINE_IMAGES.filter((img) => img.category === category);
  const pool = matches.length > 0 ? matches : CURATED_ONLINE_IMAGES;
  const seed = hash(`${topic}:${index}`);
  const chosen = pool[seed % pool.length];

  return {
    type: "image",
    src: chosen.src,
    caption: chosen.caption,
    layout,
  };
}
