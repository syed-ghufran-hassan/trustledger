use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::{
    extension::{
        transfer_hook::TransferHookAccount,
        BaseStateWithExtensions, StateWithExtensions,
    },
    state::Account as Token2022Account,
};
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList,
};
use spl_transfer_hook_interface::instruction::{ExecuteInstruction, TransferHookInstruction};

declare_id!("6AfFptyoquTBmzWFCPm783az9PDWz7gmBNcGV9hTG7bG");

#[program]
pub mod transfer_hook {
    use super::*;

    pub fn initialize_extra_account_meta_list(
        ctx: Context<InitializeExtraAccountMetaList>,
    ) -> Result<()> {
        let account_metas = vec![
            // [0] identity_registry program — placed at index 5 of Execute accounts
            ExtraAccountMeta::new_with_pubkey(
                &ctx.accounts.identity_registry_program.key(),
                false,
                false,
            )?,
            // [1] sender identity PDA — derived under identity_registry (index 5),
            //     NOT under transfer_hook
            ExtraAccountMeta::new_external_pda_with_seeds(
                5,
                &[
                    Seed::Literal { bytes: b"identity".to_vec() },
                    Seed::AccountData {
                        account_index: 0,
                        data_index: 32,
                        length: 32,
                    },
                ],
                false,
                false,
            )?,
            // [2] recipient identity PDA — derived under identity_registry (index 5)
            ExtraAccountMeta::new_external_pda_with_seeds(
                5,
                &[
                    Seed::Literal { bytes: b"identity".to_vec() },
                    Seed::AccountData {
                        account_index: 2,
                        data_index: 32,
                        length: 32,
                    },
                ],
                false,
                false,
            )?,
        ];

        let account_info = &ctx.accounts.extra_account_meta_list;
        let mut data = account_info.try_borrow_mut_data()?;
        ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &account_metas)?;
        Ok(())
    }

    pub fn execute_transfer(ctx: Context<Execute>, _amount: u64) -> Result<()> {
        {
            let source = &ctx.accounts.source_account;
            let data = source.try_borrow_data()?;
            let account = StateWithExtensions::<Token2022Account>::unpack(&data)?;
            let ext = account
                .get_extension::<TransferHookAccount>()
                .map_err(|_| error!(ErrorCode::NotTransferring))?;
            require!(bool::from(ext.transferring), ErrorCode::NotTransferring);
        }

        let remaining = &ctx.remaining_accounts;
        require!(remaining.len() >= 3, ErrorCode::MissingExtraAccounts);

        let sender = read_identity(&remaining[1])?;
        let recipient = read_identity(&remaining[2])?;

        require!(sender.kyc_verified, ErrorCode::SenderNotVerified);
        require!(!sender.sanctioned, ErrorCode::SenderSanctioned);
        require!(recipient.kyc_verified, ErrorCode::RecipientNotVerified);
        require!(!recipient.sanctioned, ErrorCode::RecipientSanctioned);

        Ok(())
    }

    pub fn fallback<'info>(
        program_id: &Pubkey,
        accounts: &'info [AccountInfo<'info>],
        data: &[u8],
    ) -> Result<()> {
        let instruction = TransferHookInstruction::unpack(data)?;
        match instruction {
            TransferHookInstruction::Execute { amount } => {
                let amount_bytes = amount.to_le_bytes();
                __private::__global::execute_transfer(program_id, accounts, &amount_bytes)
            }
            _ => return Err(ProgramError::InvalidInstructionData.into()),
        }
    }
}

fn read_identity(account: &AccountInfo) -> Result<IdentityView> {
    let data = account.try_borrow_data()?;
    if data.len() < 8 {
        return Ok(IdentityView {
            wallet: Pubkey::default(),
            kyc_verified: false,
            accredited: false,
            sanctioned: false,
            jurisdiction: String::new(),
            bump: 0,
        });
    }
    let mut slice: &[u8] = &data[8..];
    let identity = IdentityView::deserialize(&mut slice)
        .map_err(|_| error!(ErrorCode::InvalidIdentity))?;
    Ok(identity)
}

#[derive(AnchorDeserialize)]
pub struct IdentityView {
    pub wallet: Pubkey,
    pub kyc_verified: bool,
    pub accredited: bool,
    pub sanctioned: bool,
    pub jurisdiction: String,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: Token-2022 mint
    pub mint: UncheckedAccount<'info>,

    /// CHECK: identity_registry program ID
    pub identity_registry_program: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = ExtraAccountMetaList::size_of(3).unwrap(),
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump
    )]
    /// CHECK: ExtraAccountMetaList PDA
    pub extra_account_meta_list: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Execute<'info> {
    /// CHECK: source token account
    pub source_account: UncheckedAccount<'info>,
    /// CHECK: mint
    pub mint: UncheckedAccount<'info>,
    /// CHECK: destination token account
    pub destination_account: UncheckedAccount<'info>,
    /// CHECK: owner/authority
    pub owner: UncheckedAccount<'info>,
    /// CHECK: ExtraAccountMetaList PDA
    pub extra_account_meta_list: UncheckedAccount<'info>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Not a real token transfer")]
    NotTransferring,
    #[msg("Missing extra accounts")]
    MissingExtraAccounts,
    #[msg("Sender is not KYC-verified")]
    SenderNotVerified,
    #[msg("Sender is sanctioned")]
    SenderSanctioned,
    #[msg("Recipient is not KYC-verified")]
    RecipientNotVerified,
    #[msg("Recipient is sanctioned")]
    RecipientSanctioned,
    #[msg("Identity account is malformed")]
    InvalidIdentity,
}