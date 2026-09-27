import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInterviewAnalysis } from "./analysis.js";
import type { ApplicationRecord, TranscriptTurn } from "./types.js";
const application: ApplicationRecord = { id: "a", applicantName: "Sam", loanType: "personal", requestedAmount: 700000, loanPurpose: "Demo purpose", createdAt: "2026-01-01" };
const turns = (...texts: string[]): TranscriptTurn[] => texts.map((text, i) => ({ id: String(i), interviewId: "i", speaker: "borrower", text, timestamp: i }));
const report = (...texts: string[]) => buildInterviewAnalysis(application, turns(...texts));
const dialogue = (...texts: string[]) => buildInterviewAnalysis(application,
  turns(...texts).map((turn, index) => ({ ...turn, speaker: index % 2 === 0 ? "agent" : "borrower" })));

test("spoken answers populate every report financial field using question context", () => {
 const result = dialogue(
   "What is your monthly income?", "Fifty thousand rupees.",
   "How much are your monthly loan payments?", "I pay twelve thousand five hundred.",
   "What are your monthly expenses?", "It is twenty thousand per month.",
   "How much savings do you have?", "Two lakh fifty thousand.",
   "How much would you like to borrow?", "I need five lakh.",
   "What do you do for work?", "Software engineer."
 );
 assert.equal(result.structuredSummary.income.monthly, 50000);
 assert.equal(result.structuredSummary.declaredObligations.monthlyEmi, 12500);
 assert.equal(result.structuredSummary.conversationFinancials?.monthlyExpenses, 20000);
 assert.equal(result.structuredSummary.conversationFinancials?.savings, 250000);
 assert.equal(result.structuredSummary.conversationFinancials?.requestedAmount, 500000);
 assert.equal(result.structuredSummary.income.employment, "Software engineer.");
});

test("salary answers can inherit the question period but an explicit answer period wins", () => {
 assert.equal(dialogue("What is your monthly salary?", "My salary is fifty thousand.").structuredSummary.income.monthly, 50000);
 assert.equal(dialogue("What is your monthly income?", "My annual income is six lakh.").structuredSummary.income.monthly, 50000);
 assert.equal(dialogue("What is your yearly salary?", "Fifty thousand per month.").structuredSummary.income.monthly, 50000);
});

test("spoken decimal amounts and natural employment descriptions are supported", () => {
 const result = report("My monthly income is one point five lakh.", "I'm a software developer.");
 assert.equal(result.structuredSummary.income.monthly, 150000);
 assert.equal(result.structuredSummary.income.employment, "I'm a software developer.");
});

test("spoken amounts retain ambiguity and ownership safeguards", () => {
 assert.equal(report("My monthly salary is fifty thousand and ten thousand incentives.").structuredSummary.income.monthly, null);
 assert.equal(report("My wife earns fifty thousand monthly.").structuredSummary.income.monthly, null);
 assert.equal(dialogue("What are your income and expenses per month?", "Fifty thousand.").structuredSummary.income.monthly, null);
 assert.equal(report("My income might be fifty thousand monthly.").structuredSummary.income.monthly, null);
});

test("missing financial data never becomes invented employment, EMI, or application purpose", () => {
 const result = report("Hello", "I am 32 years old.");
 assert.equal(result.structuredSummary.income.monthly, null);
 assert.equal(result.structuredSummary.income.employment, null);
 assert.equal(result.structuredSummary.declaredObligations.monthlyEmi, null);
 assert.equal(result.structuredSummary.loan.purpose, "Not established in the interview");
 assert.doesNotMatch(result.summary, /bureau|4,000|salaried|700,000|Demo purpose/i);
});
test("only borrower assertions contribute numeric facts", () => {
 const result = buildInterviewAnalysis(application, [{ ...turns("Your monthly salary is 90000")[0], speaker: "agent" }]);
 assert.equal(result.structuredSummary.income.monthly, null);
});
test("Indian grouping, decimal lakh income and explicit zero EMI are preserved", () => {
 const result = report("My monthly salary is 1.25 lakh.", "My savings are INR 1,50,000.", "I have no existing EMI.");
 assert.equal(result.structuredSummary.income.monthly, 125000);
 assert.equal(result.structuredSummary.conversationFinancials?.savings, 150000);
 assert.equal(result.structuredSummary.declaredObligations.monthlyEmi, 0);
});
test("explicit annual income is normalized and EMI does not lose thousands", () => {
 const result = report("My annual salary is 6 lakh.", "My EMI is INR 12,500.");
 assert.equal(result.structuredSummary.income.monthly, 50000);
 assert.equal(result.structuredSummary.declaredObligations.monthlyEmi, 12500);
});
test("amount without a period, ambiguous amounts, estimates and other people's income remain unset", () => {
 for (const text of ["My salary is 60000", "My monthly salary is 50000 plus 10000 incentives", "My monthly income might be 60000", "My wife earns 60000 monthly", "My monthly income is 4000 dollars", "I don't earn 50000 monthly"]) {
   assert.equal(report(text).structuredSummary.income.monthly, null, text);
 }
});
test("numeric short reply uses a saved single-topic question", () => {
 const conversation = turns("What is your monthly salary?", "50000");
 conversation[0].speaker = "agent";
 const result = buildInterviewAnalysis(application, conversation);
 assert.equal(result.structuredSummary.income.monthly, 50000);
});
test("different amounts require clarification, not fabricated resolution", () => {
 const result = report("My monthly income is 50000", "My monthly income is 72000");
 assert.equal(result.structuredSummary.income.monthly, null);
 assert.equal(result.clarifications.length, 1);
 assert.doesNotMatch(result.summary, /was resolved|no material/i);
 assert.doesNotMatch(result.clarifications.join(" "), /incentives/i);
});
test("loan purpose, dependents and repayment plans remain in discussion highlights", () => {
 const result = report("I need a loan for renovating my home.", "I have two children.", "I will repay using business proceeds.");
 assert.match(result.structuredSummary.loan.purpose, /renovating/);
 assert.ok(result.notes.some(note => note.includes("two children")));
 assert.ok(result.notes.some(note => note.includes("repay")));
 assert.doesNotMatch(result.summary, /Borrower statements from the interview|Credit Bureau/);
});

test("independent income and EMI claims in one response map to their own amounts", () => {
 const result = report("My monthly income is 60000 and my EMI is 12000.");
 assert.equal(result.structuredSummary.income.monthly, 60000);
 assert.equal(result.structuredSummary.declaredObligations.monthlyEmi, 12000);
});

test("percent changes and outstanding loan balances are not monthly income or payments", () => {
 assert.equal(report("My monthly income increased by 10%.").structuredSummary.income.monthly, null);
 assert.equal(report("My annual salary increased by 50000.").structuredSummary.income.monthly, null);
 assert.equal(report("My EMI outstanding balance is 5 lakh.").structuredSummary.declaredObligations.monthlyEmi, null);
});
