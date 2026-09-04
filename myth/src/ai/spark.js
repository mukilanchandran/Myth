// The "spark" — a fresh one-liner for Boss on every open of the landing page.
// When the local AI (Ollama) is reachable it writes a brand-new line each time,
// picking a vibe from the day of week, time of day and last journal mood.
// Offline, a large curated pool keeps it feeling new anyway.
import dayjs from 'dayjs';
import { resolveAI } from './assistant';
import { streamChat } from './ollama';

const MOTIVATION = [
  'Discipline beats motivation — motivation starts, discipline finishes. 🔥',
  'Small daily wins compound into unrecognizable results in a year.',
  'The task you are avoiding takes 20 minutes. The avoiding takes all day.',
  "Done is a decision, not a feeling — ship it, Boss. 🚀",
  'Focus is saying no to 100 good ideas so one great one survives.',
  'You don\'t rise to your goals, you fall to your systems.',
  'Two-minute rule: if it takes under two minutes, do it right now.',
  'Deep work one hour today beats shallow work all week.',
  'Your future self is watching today\'s effort. Make them proud. 💪',
  'Progress loves speed of decision more than perfection of plan.',
];

const KNOWLEDGE = [
  'GK: Honey never spoils — 3000-year-old jars from Egyptian tombs are still edible. 🍯',
  'GK: Your brain uses ~20% of your energy while being 2% of your body weight.',
  'GK: The Eiffel Tower grows about 15 cm taller in summer heat.',
  'GK: Octopuses have three hearts and blue blood. 🐙',
  'GK: A day on Venus is longer than its entire year.',
  'GK: Bamboo can grow almost a metre in a single day.',
  'GK: ISRO\'s Chandrayaan-3 made India the first nation to land near the lunar south pole. 🌖',
  'GK: Sharks existed before trees — by about 50 million years.',
];

const TECH = [
  'Tech: Small local AI models like the one powering me run fully offline — your data never leaves this machine. 🤖',
  'Tech: Open-source models (Llama, Qwen, Mistral, Gemma) now rival paid ones for daily tasks — you\'re using one right now.',
  'Tech: "RAG" is how AI answers from YOUR data — exactly what I do with your tasks and money.',
  'Tech: Modern AI agents don\'t just chat — they plan, call tools and finish multi-step jobs.',
  'Tech: On-device AI is the biggest shift of this decade — private, free, and always available.',
  'Tech: Quantized models shrink 4× with almost no quality loss — that\'s how I fit in your RAM. ⚡',
  'Tech: Prompting tip — give AI your context and constraints first, the question last.',
];

// Friend-style openers keyed by day of week (0 = Sunday).
const DAY_LINES = {
  0: ["Sunday reset day, Boss — recharge, review, and let's plan the week.", 'Slow Sunday, Boss? Perfect day to clear the small stuff.'],
  1: ["Monday, Boss! Fresh week, clean slate — let's set the tone today.", 'New week, Boss. One big win today beats five small ones Friday.'],
  2: ['Tuesday grind, Boss — momentum is built on days like this.'],
  3: ["Midweek already, Boss! Halfway there — what needs a push?"],
  4: ['Thursday, Boss — strong finish loading. Clear the deck for Friday.'],
  5: ["It's Friday, Boss! What's the weekend plan? Wrap the week strong first.", "Friday vibes, Boss — close the loops today so the weekend is truly yours."],
  6: ['Saturday, Boss! Life admin or full recharge — your call today.'],
};

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Instant spark from the curated pool — always available, varies every call. */
export function pickSpark() {
  const pools = [MOTIVATION, MOTIVATION, KNOWLEDGE, TECH]; // motivation weighted higher
  return rand(rand(pools));
}

/** Day-aware friendly opener ("It's Friday, Boss — what's the plan?"). */
export function dayLine() {
  return rand(DAY_LINES[dayjs().day()]);
}

/**
 * Ask the local model for a brand-new spark line. Resolves to a string,
 * or null when no AI is reachable (caller keeps the curated fallback).
 */
export async function generateSpark(state) {
  try {
    const ai = await resolveAI(state);
    if (!ai.ok) return null;
    const mood = state.journal?.[0]?.mood;
    const moodHint = mood ? `Their last journal mood was ${mood}/5${mood <= 2 ? ' (low — be uplifting, gentle)' : mood >= 4 ? ' (high — match the energy)' : ''}.` : '';
    const category = rand([
      'a punchy motivation line',
      'a surprising general-knowledge fact',
      'a fresh tech/AI insight or practical tip',
      'a friendly check-in about their day or upcoming weekend',
    ]);
    const text = await streamChat({
      endpoint: ai.endpoint, model: ai.model, apiKey: ai.apiKey, temperature: 1.0,
      messages: [
        {
          role: 'system',
          content: `You are Myth, Boss's personal-assistant friend. Reply with exactly ONE line, max 22 words, at most one emoji, no quotes, no preamble. Address them as "Boss" when natural.`,
        },
        {
          role: 'user',
          content: `Today is ${dayjs().format('dddd, MMMM D, YYYY')}, ${dayjs().format('h a')}. ${moodHint} Give me ${category}. Make it feel new — avoid clichés like "seize the day".`,
        },
      ],
    });
    const clean = text?.replace(/^["'\s]+|["'\s]+$/g, '').split('\n')[0];
    return clean && clean.length > 8 ? clean : null;
  } catch {
    return null;
  }
}
