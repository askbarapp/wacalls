export interface PromptBuilderInput {
  businessName?: string;
  businessCategory?: string;
  brandColors?: string;
  brandStyle?: string;
  products?: string;
  services?: string;
  defaultOffer?: string;
  festivalName?: string;
  userInstruction?: string;
  creativeType?: string; // "poster" | "banner" | "status"
  aspect?: string; // "1:1" | "9:16" | "16:9" | "4:5"
  language?: string;

  // Custom typography & concept
  headlineText?: string;
  ctaText?: string;
  conceptTheme?: string;

  // Business branding metadata
  phone?: string;
  email?: string;
  website?: string;
  logoUrl?: string;
  showPhone?: boolean;
  showWebsite?: boolean;
  showEmail?: boolean;
  showLogo?: boolean;
}

/**
 * Builds commercial, high-aesthetic AI prompts for creative poster and banner generation.
 *
 * CRITICAL RULE ENFORCEMENT:
 * 1. Never invent promotional discounts or pricing offers unless explicitly present.
 * 2. Strict typography guard: clean, perfectly spelled text without gibberish or distorted characters.
 */
export function buildCreativePrompt(input: PromptBuilderInput): string {
  const parts: string[] = [];

  // 1. Creative Type & Aesthetic Foundation
  const type = (input.creativeType || "poster").toLowerCase();
  const festival = input.festivalName?.trim();
  const category = input.businessCategory?.trim() || "Commercial Business";
  const brandName = input.businessName?.trim();
  const theme = (input.conceptTheme || "").toLowerCase();

  if (festival) {
    parts.push(
      `A stunning, premium commercial advertising ${type} celebrating ${festival} for "${brandName || category}".`,
    );
    parts.push(
      `Rich celebratory festive theme with radiant traditional elements, glowing festive lights, diya lamps, elegant floral decorations, celebratory atmosphere.`,
    );
  } else {
    parts.push(
      `A modern, high-converting commercial business promotional ${type} for "${brandName || category}".`,
    );
  }

  // 2. Concept & Aesthetic Theme Style
  if (theme.includes("minimal")) {
    parts.push(`Aesthetic: Modern minimalist design, clean lines, generous negative breathing space, sophisticated typography.`);
  } else if (theme.includes("traditional") || theme.includes("festive")) {
    parts.push(`Aesthetic: Royal traditional celebration, authentic cultural heritage, glowing warm ambient illumination, ornate festive motifs.`);
  } else if (theme.includes("bold") || theme.includes("commercial") || theme.includes("sale")) {
    parts.push(`Aesthetic: High-energy commercial retail advertising, punchy vibrant contrast, dynamic poster layout, eye-catching sales promotion.`);
  } else if (theme.includes("luxury") || theme.includes("elegant")) {
    parts.push(`Aesthetic: Ultra-luxury premium aesthetic, refined gold foil accents, dark textured matte backdrop, cinematic rim lighting.`);
  } else if (theme.includes("corporate") || theme.includes("tech")) {
    parts.push(`Aesthetic: Clean corporate professional branding, crisp geometric structure, trustworthy blue and white tones.`);
  }

  // 3. Business Category & Product Showcase
  if (input.products || input.services) {
    const items = input.products || input.services;
    parts.push(`Hero centerpiece showcasing: ${items}. Clean, appetizing, premium product presentation.`);
  } else {
    parts.push(`Featuring a sophisticated, professional focal presentation relevant to ${category}.`);
  }

  // 4. Branding & Visual Aesthetics
  const colors = input.brandColors?.trim() || (festival ? "Gold, Royal Red and Warm Amber" : "Navy Blue, Gold, and Crisp White");
  const style = input.brandStyle?.trim() || "Premium, elegant, cinematic 3D lighting, commercial studio quality";
  parts.push(`Color palette: ${colors}.`);
  parts.push(`Visual aesthetic: ${style}, high-end branding, hyper-detailed, photorealistic 8K render.`);

  // 5. Custom Typography & Headline
  if (input.headlineText && input.headlineText.trim()) {
    parts.push(`Prominent graphic design typography headline clearly reading: "${input.headlineText.trim()}".`);
  } else if (input.defaultOffer && input.defaultOffer.trim()) {
    parts.push(`Featuring promotional highlight: "${input.defaultOffer.trim()}".`);
  } else if (festival) {
    parts.push(`Featuring warm festive greetings and prosperity wishes to all customers.`);
  } else {
    parts.push(`Featuring professional brand tagline.`);
  }

  // 6. Call To Action (CTA) Badge
  if (input.ctaText && input.ctaText.trim()) {
    parts.push(`Prominent call-to-action button badge reading: "${input.ctaText.trim()}".`);
  }

  // 7. Business Branding Footer Bar (Phone, Website, Email, Logo)
  const contactDetails: string[] = [];
  if (input.showPhone && input.phone?.trim()) {
    contactDetails.push(`Phone: ${input.phone.trim()}`);
  }
  if (input.showWebsite && input.website?.trim()) {
    contactDetails.push(`Web: ${input.website.trim()}`);
  }
  if (input.showEmail && input.email?.trim()) {
    contactDetails.push(`Email: ${input.email.trim()}`);
  }

  if (contactDetails.length > 0) {
    parts.push(`Clean, professional lower branding bar displaying contact details: ${contactDetails.join(" | ")}.`);
  }

  if (input.showLogo && (input.logoUrl?.trim() || brandName)) {
    parts.push(`Upper corner subtle brand logo emblem placement for "${brandName || 'Brand'}".`);
  }

  // 8. Specific User Instructions
  if (input.userInstruction && input.userInstruction.trim()) {
    const sanitized = input.userInstruction
      .replace(/(?:diwali|poster|bana do|banao|banner|creative)/gi, "")
      .trim();
    if (sanitized.length > 3) {
      parts.push(`Custom visual details: ${sanitized}.`);
    }
  }

  // 9. Aspect Ratio & Framing Composition
  const aspect = input.aspect || "1:1";
  if (aspect === "9:16") {
    parts.push(`Vertical 1080x1920 mobile story layout, upper visual focus with balanced vertical negative space for WhatsApp status.`);
  } else if (aspect === "16:9") {
    parts.push(`Wide 1920x1080 horizontal billboard banner layout, panoramic split composition with product hero on one side and typography on the other.`);
  } else if (aspect === "4:5") {
    parts.push(`Portrait 1080x1350 social feed layout, optimized mobile framing with high visual impact.`);
  } else {
    parts.push(`Square 1024x1024 feed composition, balanced central focal hierarchy.`);
  }

  // 10. Strict Poster Guard (Anti-Gibberish & Spelling Integrity)
  parts.push(
    `Perfect graphic design composition, razor-sharp legible typography, correctly spelled English words, zero gibberish text, no distorted letters, no scrambled or mutated characters, no duplicate glyphs, clean vector-like font rendering, cinematic studio lighting, trending on Behance.`,
  );

  return parts.join(" ");
}

/**
 * Builds Smart-Edit instruction prompt to modify an existing image.
 */
export function buildSmartEditPrompt(originalPrompt: string, userEditInstruction: string): string {
  const instruction = userEditInstruction.trim();
  return `Modify the previous creative image based on this specific instruction: "${instruction}". Preserve all other background elements, product details, brand identity, legible typography, and overall high-quality aesthetic.`;
}
