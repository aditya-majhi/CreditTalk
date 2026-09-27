import type { ApplicationRecord, BorrowerFact, InterviewAnalysis, StructuredInterviewSummary, TranscriptTurn } from "./types.js";

const money = (value: number) => `INR ${value.toLocaleString("en-IN")}`;
const topics = {
  monthlyIncome: /\b(salary|income|earn|earning|earnings|take.home)\b/i,
  existingEmi: /\b(emi|emis|installments?|instalments?|loan (?:payments?|repayments?)|pay.*(?:loans?|debts?))\b/i,
  monthlyExpenses: /\b(expenses?|spend|spending|rent|household costs?)\b/i,
  savings: /\b(savings|saved|bank balance|set aside)\b/i,
  requestedAmount: /\b(borrow|borrowing|loan amount|need a loan|want a loan|requesting|loan size)\b/i,
};
const monthly = /\b(monthly|per month|a month|each month|every month)\b|\/month/i;
const annual = /\b(annually|annual|yearly|per year|a year|per annum|lpa)\b/i;
const uncertain = /\b(maybe|might|expect|expected|would|could|if|approximately|about|around)\b/i;

const numberWords: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const scales: Record<string, number> = { hundred: 100, thousand: 1000, lakh: 100000, lakhs: 100000, lac: 100000, lacs: 100000, million: 1000000, crore: 10000000, crores: 10000000 };
const wordPattern = Object.keys(numberWords).join("|");
const scalePattern = Object.keys(scales).join("|");

// STT can return words instead of digits. Normalize only recognizable number
// phrases; keep the original transcript for evidence and discussion notes.
function normalizeSpokenAmounts(text: string): string {
  const decimals = text.replace(new RegExp(`\\b(${wordPattern}) point ((?:(?:zero|one|two|three|four|five|six|seven|eight|nine)(?:[ -]+|$))*)(zero|one|two|three|four|five|six|seven|eight|nine)\\b`, "gi"),
    (_match, whole: string, middle: string, last: string) => `${numberWords[whole.toLowerCase()]}.${`${middle} ${last}`.trim().split(/[ -]+/).map(word => numberWords[word.toLowerCase()]).join("")}`);
  return decimals.replace(new RegExp(`\\b(?:${wordPattern})(?:[ -]+(?:${wordPattern}|${scalePattern}|and(?= (?:${wordPattern}))))*\\b`, "gi"), phrase => {
    let total = 0, group = 0, previous: number | undefined;
    for (const token of phrase.toLowerCase().split(/[ -]+/)) {
      if (token === "and") {
        if (!/hundred|thousand|lakh|lac|million|crore/i.test(phrase)) return phrase;
        continue;
      }
      if (token in numberWords) {
        const value = numberWords[token];
        if (previous !== undefined && !(previous >= 20 && previous % 10 === 0 && value > 0 && value < 10)) return phrase;
        group += value;
        previous = value;
      } else {
        if (token === "hundred") group *= 100;
        else { total += group * scales[token]; group = 0; }
        previous = undefined;
      }
    }
    return String(total + group);
  });
}

// A number is only promoted into a financial field when its meaning and period
// are explicit. Ambiguous amounts stay in the discussion notes for review.
function singleAmount(text: string): number | null {
  text = normalizeSpokenAmounts(text);
  if (/%|[-\u2212]\s*\d/.test(text)) return null;
  if (/[$\u20ac\u00a3]|\b(usd|eur|gbp|dollars?|euros?|pounds?)\b/i.test(text)) return null;
  const hits = [...text.matchAll(/\b(\d[\d,]*(?:\.\d+)?)\s*(crores?|cr|lakhs?|lacs?|lpa|thousand|k)?\b/gi)];
  if (hits.length !== 1) return null;
  const [, amount, unit = ""] = hits[0];
  const multiplier = /crore|^cr$/i.test(unit) ? 10000000 : /lakh|lac|lpa/i.test(unit) ? 100000 : /thousand|^k$/i.test(unit) ? 1000 : 1;
  const value = Number(amount.replace(/,/g, "")) * multiplier;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function extractFacts(turns: TranscriptTurn[]): BorrowerFact[] {
  const facts: BorrowerFact[] = [];
  let question = "";
  for (const turn of turns) {
    if (turn.speaker === "agent") { question = turn.text; continue; }
    const text = turn.text.trim();
    if (!text) continue;
    const add = (key: string, value: unknown, category: string) => facts.push({ key, value, category, sourceTurnId: turn.id });
    const pieces = text.split(/\s+(?:and|but)\s+|;\s*|(?<=[.!?])\s+/i).filter(Boolean);
    // Split only independent financial claims. Do not turn salary components
    // such as "50000 and 10000 incentives" into an asserted total income.
    const clauses = pieces.length > 1 && pieces.every(piece => Object.values(topics).some(pattern => pattern.test(piece))) ? pieces : [text];
    for (const claim of clauses) {
      const text = claim;
    // Context is used only for a short numeric answer to a single-topic question.
    const explicitTopics = Object.entries(topics).filter(([, pattern]) => pattern.test(text));
    const normalizedAnswer = normalizeSpokenAmounts(text)
      .replace(/^(?:(?:yes|well|okay)[, ]+)?(?:(?:it(?:'s| is)|that(?:'s| is)|i (?:earn|make|pay|spend|have|need)|i(?:'m| am) (?:earning|making|paying|spending|requesting))\s+)?/i, "")
      .replace(/\brupees\b/gi, "").trim();
    const shortAnswer = /^(?:(?:rs\.?|inr|\u20b9)\s*)?\d[\d,]*(?:\.\d+)?\s*(?:crores?|cr|lakhs?|lacs?|lpa|thousand|k)?(?:\s+(?:per month|a month|each month|monthly|per year|a year|annually))?[.!]?$/i.test(normalizedAnswer);
    const contextTopics = Object.entries(topics).filter(([, pattern]) => pattern.test(question));
    const identified = explicitTopics.length ? explicitTopics : shortAnswer && contextTopics.length === 1 ? contextTopics : [];
    // A borrower often repeats the topic but omits the period: "My salary is
    // fifty thousand" after "What is your monthly salary?".
    const matchesQuestion = identified.length === 1 && contextTopics.length === 1 && identified[0][0] === contextTopics[0][0];
    const context = matchesQuestion ? `${question} ${text}` : text;
    const periodContext = monthly.test(text) || annual.test(text) ? text : context;
    if (identified.length === 1 && !uncertain.test(text) && !/\b(not|never|used to|don't|doesn't)\b|\?/i.test(text)) {
      const [key] = identified[0];
      let value = singleAmount(text);
      if (/\b(increased?|decreased?|raise|bonus|incentives?)\b/i.test(text)) value = null;
      if (key === "existingEmi" && /\b(outstanding|balance|principal)\b/i.test(text)) value = null;
      if (key === "monthlyExpenses" && !/\b(expenses?|spend|spending|household costs?)\b/i.test(context)) value = null;
      if (key === "monthlyIncome" && /\b(wife|husband|partner|father|mother|brother|sister|friend|household|family|business)\b/i.test(context)) value = null;
      if (key === "existingEmi" && /\b(no|zero) (?:existing |current )?(?:emi|emis|installments?|instalments?|loan payments?)\b/i.test(text)) value = 0;
      const recurring = ["monthlyIncome", "monthlyExpenses", "existingEmi"].includes(key);
      if (value !== null && (!recurring || monthly.test(periodContext) || annual.test(periodContext) || (key === "existingEmi" && (value === 0 || /\bemis?\b/i.test(context))))) {
        if (recurring && annual.test(periodContext) && monthly.test(periodContext)) value = null;
        if (value !== null) add(key, recurring && annual.test(periodContext) ? Math.round(value / 12 * 100) / 100 : value, "financial");
      }
    }
    }
    const employmentQuestion = /\b(occupation|employment|what do you do|work do you do|work as|job title|profession|where do you work)\b/i.test(question);
    const employmentStatement = /\b(i work|i run|my job|my business|self.employed|unemployed|retired|salaried|i(?: am|'m) (?:a|an) (?:\w+\s+){0,3}(?:teacher|engineer|developer|doctor|driver|nurse|accountant|employee|manager|consultant|freelancer|owner|designer|analyst))\b/i.test(text);
    const employmentAnswer = employmentQuestion && /\b(engineer|developer|teacher|doctor|driver|nurse|accountant|employee|manager|consultant|freelancer|business|owner|student|designer|analyst|sales|employed|retired|unemployed)\b/i.test(text);
    if (employmentStatement || employmentAnswer) add("employmentType", text, "employment");
    if (/\b(loan is for|loan for|use (?:the |this )?(?:loan|money)|purpose|renovat|buy a|buying a|expand my|expand our)\w*/i.test(text)) add("loanPurpose", text, "purpose");
    // Preserve relevant statements even when numbers cannot be safely normalized.
    if (Object.values(topics).some(pattern => pattern.test(text)) || /\b(dependents?|children|family|repay|repayment|assets?|own|property|business|job|work|employed|retired|purpose|renovat|education|medical|wedding)\w*/i.test(text)) add("discussion", text, "discussion");
    question = "";
  }
  return facts;
}

function numericFact(facts: BorrowerFact[], key: string): number | null {
  const values = [...new Set(facts.filter(f => f.key === key && typeof f.value === "number").map(f => f.value as number))];
  return values.length === 1 ? values[0] : null;
}
function textFact(facts: BorrowerFact[], key: string): string | null {
  const values = [...new Set(facts.filter(f => f.key === key).map(f => String(f.value)))];
  return values.length ? values.join(" ") : null;
}
export function updateNotes(facts: BorrowerFact[]): string[] {
  return [...new Set(facts.filter(f => ["discussion", "employmentType", "loanPurpose"].includes(f.key)).map(f => String(f.value)))];
}
export function detectInconsistencies(turns: TranscriptTurn[]): InterviewAnalysis["inconsistencies"] {
  const facts = extractFacts(turns);
  return Object.keys(topics).flatMap(key => {
    const values = [...new Set(facts.filter(f => f.key === key && typeof f.value === "number").map(f => f.value as number))];
    return values.length > 1 ? [{ title: `Different amounts reported for ${key.replace(/([A-Z])/g, " $1").toLowerCase()}`, earlier: money(values[0]), later: values.slice(1).map(money).join(", "), status: "needs_clarification" as const }] : [];
  });
}
export function generateSummary(
  applicantName: string, _loanType: string, _amount: number,
  facts: BorrowerFact[], inconsistencies: InterviewAnalysis["inconsistencies"], turns: TranscriptTurn[] = []
): string {
  if (!turns.some(t => t.speaker === "borrower" && t.text.trim())) return "No borrower conversation is available for this interview. Financial details have not been established.";
  const lines = [`Interview with ${applicantName}.`];
  const purpose = textFact(facts, "loanPurpose");
  if (purpose) lines.push(`Purpose discussed: ${purpose}`);
  const fields: [string, string][] = [["monthlyIncome", "Reported monthly income"], ["existingEmi", "Reported monthly loan payments"], ["monthlyExpenses", "Reported monthly expenses"], ["savings", "Reported savings"], ["requestedAmount", "Loan amount discussed"]];
  for (const [key, label] of fields) {
    const value = numericFact(facts, key);
    if (value !== null) lines.push(`${label}: ${money(value)}.`);
  }
  const employment = textFact(facts, "employmentType");
  if (employment && employment !== purpose) lines.push(`Work discussed: ${employment}`);
  if (inconsistencies.length) lines.push("Different financial amounts were stated; these need clarification before relying on a single figure.");
  if (lines.length === 1) lines.push("The conversation does not establish unambiguous financial figures. Review the recorded discussion points below.");
  return lines.join(" ");
}
export function generateStructuredSummary(
  applicantName: string, loanType: string, amount: number, _purpose: string,
  facts: BorrowerFact[], clarifications: string[]
): StructuredInterviewSummary {
  return {
    applicant: applicantName,
    loan: { type: loanType, requestedAmount: amount, purpose: textFact(facts, "loanPurpose") ?? "Not established in the interview" },
    income: { monthly: numericFact(facts, "monthlyIncome"), employment: textFact(facts, "employmentType") },
    declaredObligations: { monthlyEmi: numericFact(facts, "existingEmi") },
    conversationFinancials: { monthlyExpenses: numericFact(facts, "monthlyExpenses"), savings: numericFact(facts, "savings"), requestedAmount: numericFact(facts, "requestedAmount") },
    clarifications,
    creditBureau: { status: "not_connected" },
  };
}

export function buildInterviewAnalysis(application: ApplicationRecord, turns: TranscriptTurn[]): InterviewAnalysis {
  const facts = extractFacts(turns);
  const inconsistencies = detectInconsistencies(turns);
  const clarifications = inconsistencies.map(item => `${item.title}: ${item.earlier} and ${item.later}. Confirm the applicable amount.`);
  return {
    facts, notes: updateNotes(facts), inconsistencies, clarifications,
    summary: generateSummary(application.applicantName, application.loanType, application.requestedAmount, facts, inconsistencies, turns),
    structuredSummary: generateStructuredSummary(application.applicantName, application.loanType, application.requestedAmount, application.loanPurpose ?? "", facts, clarifications),
    creditBureauStatus: "not_connected",
  };
}
