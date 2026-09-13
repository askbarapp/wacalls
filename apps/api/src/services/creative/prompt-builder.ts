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
  aspect?: string;
  language?: string;
}

/**
 * Builds commercial, high-aesthetic AI prompts for creative generation.
 *
 * CRITICAL RULE ENFORCEMENT:
 * Never invent promotional discounts or pricing offers (e.g. "50% OFF", "Buy 1 Get 1")
 * unless explicitly present in the business profile's defaultOffer or provided by the user.
 */
export function buildCreativePrompt(input: PromptBuilderInput): string {
  const parts: string[] = [];

  // 1. Creative Type & Aesthetic Foundation
  const type = (input.creativeType || "poster").toLowerCase();
  const festival = input.festivalName?.trim();
  const category = input.businessCategory?.trim() || "Commercial Business";
  const brandName = input.businessName?.trim();

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

  // 2. Business Category & Product Showcase
  if (input.products || input.services) {
    const items = input.products || input.services;
    parts.push(`Hero centerpiece showcasing: ${items}. Clean, appetizing, premium product presentation.`);
  } else {
    parts.push(`Featuring a sophisticated, professional focal presentation relevant to ${category}.`);
  }

  // 3. Branding & Visual Aesthetics
  const colors = input.brandColors?.trim() || (festival ? "Gold, Royal Red and Warm Amber" : "Navy Blue, Gold, and Crisp White");
  const style = input.brandStyle?.trim() || "Premium, elegant, cinematic 3D lighting, commercial studio quality";
  parts.push(`Color palette: ${colors}.`);
  parts.push(`Visual aesthetic: ${style}, high-end branding, hyper-detailed, photorealistic 8K render.`);

  // 4. Offer or Tagline (Strictly verified — NEVER invented!)
  if (input.defaultOffer && input.defaultOffer.trim()) {
    parts.push(`Featuring promotional highlight: "${input.defaultOffer.trim()}".`);
  } else if (festival) {
    parts.push(`Featuring warm festive greetings and prosperity wishes to all customers.`);
  } else {
    parts.push(`Featuring professional brand tagline and trust-building call to action.`);
  }

  // 5. Specific User Instructions
  if (input.userInstruction && input.userInstruction.trim()) {
    const sanitized = input.userInstruction
      .replace(/(?:diwali|poster|bana do|banao|banner|creative)/gi, "")
      .trim();
    if (sanitized.length > 3) {
      parts.push(`Custom details: ${sanitized}.`);
    }
  }

  // 6. Composition & Text Space
  parts.push(
    `Perfect composition, generous negative space for typography, crisp brand layout, cinematic studio lighting, trending on Behance.`,
  );

  return parts.join(" ");
}

/**
 * Builds Smart-Edit instruction prompt to modify an existing image.
 */
export function buildSmartEditPrompt(originalPrompt: string, userEditInstruction: string): string {
  const instruction = userEditInstruction.trim();
  return `Modify the previous creative image based on this specific instruction: "${instruction}". Preserve all other background elements, product details, brand identity, and overall high-quality aesthetic.`;
}
