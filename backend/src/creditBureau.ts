import type { CreditBureauProvider, CreditReport } from "./types.js";
import axios from "axios";

export class DemoCreditBureauProvider implements CreditBureauProvider {
  isConfigured(): boolean {
    return Boolean(
      process.env.CREDIT_BUREAU_PROVIDER &&
      process.env.CREDIT_BUREAU_API_URL &&
      process.env.CREDIT_BUREAU_API_KEY
    );
  }

  async getCreditReport(input: {
    applicantId: string;
    consentReference: string;
  }): Promise<CreditReport> {
    if (!this.isConfigured()) {
      return {
        status: "not_connected",
        provider: "not_configured",
        accountsFound: [],
        differences: [],
      };
    }

    const response = await axios.post<{
      accountsFound?: Array<{ name: string; status: string; balance?: number }>;
      differences?: string[];
      provider?: string;
    }>(
      process.env.CREDIT_BUREAU_API_URL as string,
      {
        applicantId: input.applicantId,
        consentReference: input.consentReference,
      },
      {
        headers: {
          authorization: `Bearer ${process.env.CREDIT_BUREAU_API_KEY}`,
          "content-type": "application/json",
        },
      }
    );
    const payload = response.data;

    return {
      status: "connected",
      provider: payload.provider ?? process.env.CREDIT_BUREAU_PROVIDER,
      accountsFound: payload.accountsFound ?? [],
      differences: payload.differences ?? [],
    };
  }
}
