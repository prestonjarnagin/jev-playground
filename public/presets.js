export const PRESETS = [
  {
    name: "Support ticket triage",
    input: {
      state: "Help! My payouts have been failing for 3 days.",
      questions: {
        is_urgent: {
          type: "noul",
          instructions: "Does this convey urgency?",
          criteria: { true: "Explicitly time-sensitive", false: "No urgency expressed" },
        },
        department: {
          type: "choice",
          instructions: "Which team should handle this?",
          criteria: {
            billing: "Payments, invoicing, refunds",
            technical: "Bugs, outages, integrations",
            sales: "Pricing, upgrades, new accounts",
          },
        },
        frustration: {
          type: "score",
          instructions: "How frustrated is the customer?",
          criteria: ["Calm", "Frustrated", "Very angry"],
        },
      },
    },
  },
  {
    name: "Refund review",
    input: {
      state: {
        ticket: {
          subject: "Duplicate charge",
          message: "I was charged twice for order A-104. Please refund the duplicate.",
        },
        order: {
          id: "A-104",
          charges: [
            { amount_usd: 49, status: "captured" },
            { amount_usd: 49, status: "captured" },
          ],
        },
        refund_policy: "Duplicate charges are eligible for a refund.",
      },
      questions: {
        refund_requested: { type: "noul", instructions: "Does `ticket.message` request a refund?" },
        policy_supports_refund: {
          type: "noul",
          instructions: "Does `refund_policy` support the refund requested in `ticket.message`, given `order.charges`?",
        },
      },
    },
  },
  {
    name: "Account risk",
    input: {
      state: {
        account_age_days: 12,
        recent_events: [
          "Five failed login attempts",
          "Password reset requested from a new country",
          "Successful login from the usual device",
        ],
        account_verified: true,
      },
      questions: {
        risk_level: {
          type: "score",
          instructions: "How risky does this account activity appear?",
          criteria: [
            "Low risk: activity is consistent with the account history",
            "Moderate risk: some unusual activity needs monitoring",
            "High risk: multiple strong indicators of account compromise",
          ],
        },
        escalate: {
          type: "noul",
          instructions: "Should this account be escalated for manual security review?",
          criteria: {
            true: "The activity warrants immediate human review",
            false: "The activity can be handled with normal automated controls",
          },
        },
      },
    },
  },
  {
    name: "Duplicate resume check",
    input: {
      state: {
        resume: {
          name: "Jonathan Smith",
          location: "Oakland, CA",
          experience: ["Senior engineer, Google (2019-2024)", "Engineer, Stripe (2015-2019)"],
        },
      },
      questions: {
        same_person: {
          type: "noul",
          instructions: {
            potential_duplicate: { name: "John Smith", location: "Oakland, California", last_employer: "Google" },
            question: "Is the resume for the same person as `potential_duplicate`?",
          },
        },
      },
    },
  },
];
