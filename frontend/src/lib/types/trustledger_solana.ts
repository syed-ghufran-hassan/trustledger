/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/trustledger_solana.json`.
 */
export type TrustledgerSolana = {
  "address": "E6iVUfnGNReT7RpueSs94yCX5S2Ua1mdh3FefD6HXZam",
  "metadata": {
    "name": "trustledgerSolana",
    "version": "0.1.0",
    "spec": "0.1.0"
  },
  "instructions": [
    {
      "name": "createLoan",
      "discriminator": [
        166,
        131,
        118,
        219,
        138,
        218,
        206,
        140
      ],
      "accounts": [
        {
          "name": "originator",
          "writable": true,
          "signer": true
        },
        {
          "name": "loanAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  97,
                  110
                ]
              },
              {
                "kind": "arg",
                "path": "loanId"
              }
            ]
          }
        },
        {
          "name": "mint",
          "writable": true,
          "signer": true
        },
        {
          "name": "transferHookProgram"
        },
        {
          "name": "tokenProgram",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "loanId",
          "type": "string"
        },
        {
          "name": "borrowerName",
          "type": "string"
        },
        {
          "name": "principal",
          "type": "u64"
        },
        {
          "name": "interestRateBps",
          "type": "u16"
        },
        {
          "name": "maturity",
          "type": "i64"
        }
      ]
    },
    {
      "name": "mintLoanTokens",
      "discriminator": [
        137,
        117,
        209,
        221,
        10,
        4,
        70,
        114
      ],
      "accounts": [
        {
          "name": "originator",
          "writable": true,
          "signer": true
        },
        {
          "name": "loanAccount",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  97,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "loan_account.loan_id",
                "account": "loanAccount"
              }
            ]
          }
        },
        {
          "name": "mint",
          "writable": true
        },
        {
          "name": "destination",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "loanAccount",
      "discriminator": [
        223,
        49,
        62,
        167,
        247,
        182,
        239,
        60
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "loanIdTooLong",
      "msg": "Loan ID must be ≤ 32 characters"
    },
    {
      "code": 6001,
      "name": "borrowerNameTooLong",
      "msg": "Borrower name must be ≤ 64 characters"
    },
    {
      "code": 6002,
      "name": "unauthorized",
      "msg": "Only the loan originator can perform this action"
    },
    {
      "code": 6003,
      "name": "mintMismatch",
      "msg": "Provided mint does not match loan account"
    }
  ],
  "types": [
    {
      "name": "loanAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "originator",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "loanId",
            "type": "string"
          },
          {
            "name": "borrowerName",
            "type": "string"
          },
          {
            "name": "principal",
            "type": "u64"
          },
          {
            "name": "interestRateBps",
            "type": "u16"
          },
          {
            "name": "maturity",
            "type": "i64"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
