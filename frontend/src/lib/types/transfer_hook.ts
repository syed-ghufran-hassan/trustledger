/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/transfer_hook.json`.
 */
export type TransferHook = {
  "address": "6AfFptyoquTBmzWFCPm783az9PDWz7gmBNcGV9hTG7bG",
  "metadata": {
    "name": "transferHook",
    "version": "0.1.0",
    "spec": "0.1.0"
  },
  "instructions": [
    {
      "name": "executeTransfer",
      "discriminator": [
        233,
        126,
        160,
        184,
        235,
        206,
        31,
        119
      ],
      "accounts": [
        {
          "name": "sourceAccount"
        },
        {
          "name": "mint"
        },
        {
          "name": "destinationAccount"
        },
        {
          "name": "owner"
        },
        {
          "name": "extraAccountMetaList"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initializeExtraAccountMetaList",
      "discriminator": [
        92,
        197,
        174,
        197,
        41,
        124,
        19,
        3
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "mint"
        },
        {
          "name": "identityRegistryProgram"
        },
        {
          "name": "extraAccountMetaList",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  120,
                  116,
                  114,
                  97,
                  45,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  45,
                  109,
                  101,
                  116,
                  97,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "notTransferring",
      "msg": "Not a real token transfer"
    },
    {
      "code": 6001,
      "name": "missingExtraAccounts",
      "msg": "Missing extra accounts"
    },
    {
      "code": 6002,
      "name": "senderNotVerified",
      "msg": "Sender is not KYC-verified"
    },
    {
      "code": 6003,
      "name": "senderSanctioned",
      "msg": "Sender is sanctioned"
    },
    {
      "code": 6004,
      "name": "recipientNotVerified",
      "msg": "Recipient is not KYC-verified"
    },
    {
      "code": 6005,
      "name": "recipientSanctioned",
      "msg": "Recipient is sanctioned"
    },
    {
      "code": 6006,
      "name": "invalidIdentity",
      "msg": "Identity account is malformed"
    }
  ]
};
