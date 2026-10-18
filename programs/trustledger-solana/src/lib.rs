use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke;
use anchor_lang::solana_program::rent::Rent;
use anchor_lang::system_program::{create_account, CreateAccount};
use anchor_spl::token_2022::spl_token_2022::{
    self,
    extension::{pausable, transfer_hook, ExtensionType},
    state::Mint as Token2022Mint,
};

declare_id!("E6iVUfnGNReT7RpueSs94yCX5S2Ua1mdh3FefD6HXZam");

const MAX_LOAN_ID: usize = 32;
const MAX_BORROWER_NAME: usize = 64;

#[program]
pub mod trustledger_solana {
    use super::*;

    pub fn create_loan(
        ctx: Context<CreateLoan>,
        loan_id: String,
        borrower_name: String,
        principal: u64,
        interest_rate_bps: u16,
        maturity: i64,
    ) -> Result<()> {
        require!(loan_id.len() <= MAX_LOAN_ID, ErrorCode::LoanIdTooLong);
        require!(borrower_name.len() <= MAX_BORROWER_NAME, ErrorCode::BorrowerNameTooLong);

        // 1. Allocate space for base mint + all three extensions
        let extensions = &[
            ExtensionType::TransferHook,
            ExtensionType::PermanentDelegate,
            ExtensionType::Pausable,
        ];
        let space = ExtensionType::try_calculate_account_len::<Token2022Mint>(extensions)?;
        let lamports = Rent::get()?.minimum_balance(space);

        // 2. Create the mint account owned by Token-2022
        create_account(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                CreateAccount {
                    from: ctx.accounts.originator.to_account_info(),
                    to: ctx.accounts.mint.to_account_info(),
                },
            ),
            lamports,
            space as u64,
            &spl_token_2022::ID,
        )?;

        // 3. Initialize extensions BEFORE the mint (critical!)
        // 3a. TransferHook
        let ix = transfer_hook::instruction::initialize(
            &spl_token_2022::ID,
            &ctx.accounts.mint.key(),
            Some(ctx.accounts.originator.key()),
            Some(ctx.accounts.transfer_hook_program.key()),
        )?;
        invoke(
            &ix,
            &[
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
            ],
        )?;

        // 3b. PermanentDelegate — use the instruction module, not extension module
        let ix = spl_token_2022::instruction::initialize_permanent_delegate(
            &spl_token_2022::ID,
            &ctx.accounts.mint.key(),
            &ctx.accounts.originator.key(),
        )?;
        invoke(
            &ix,
            &[
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
            ],
        )?;

        // 3c. Pausable — authority is &Pubkey, NOT Option<Pubkey>
        let ix = pausable::instruction::initialize(
            &spl_token_2022::ID,
            &ctx.accounts.mint.key(),
            &ctx.accounts.originator.key(),
        )?;
        invoke(
            &ix,
            &[
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
            ],
        )?;

        // 4. NOW initialize the base mint (must come AFTER extensions)
        let ix = spl_token_2022::instruction::initialize_mint2(
            &spl_token_2022::ID,
            &ctx.accounts.mint.key(),
            &ctx.accounts.originator.key(),
            Some(&ctx.accounts.originator.key()),
            0, // decimals — tokenized loan units are whole numbers
        )?;
        invoke(
            &ix,
            &[
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
            ],
        )?;

        // 5. Store loan metadata
        let loan = &mut ctx.accounts.loan_account;
        loan.originator = ctx.accounts.originator.key();
        loan.mint = ctx.accounts.mint.key();
        loan.loan_id = loan_id;
        loan.borrower_name = borrower_name;
        loan.principal = principal;
        loan.interest_rate_bps = interest_rate_bps;
        loan.maturity = maturity;
        loan.paused = false;
        loan.bump = ctx.bumps.loan_account;

        Ok(())
    }

    pub fn mint_loan_tokens(ctx: Context<MintLoanTokens>, amount: u64) -> Result<()> {
        let ix = spl_token_2022::instruction::mint_to(
            &spl_token_2022::ID,
            &ctx.accounts.mint.key(),
            &ctx.accounts.destination.key(),
            &ctx.accounts.originator.key(),
            &[],
            amount,
        )?;
        invoke(
            &ix,
            &[
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.destination.to_account_info(),
                ctx.accounts.originator.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
            ],
        )?;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(loan_id: String)]
pub struct CreateLoan<'info> {
    #[account(mut)]
    pub originator: Signer<'info>,

    #[account(
        init,
        payer = originator,
        space = 8 + LoanAccount::INIT_SPACE,
        seeds = [b"loan", loan_id.as_bytes()],
        bump
    )]
    pub loan_account: Account<'info, LoanAccount>,

    /// CHECK: Token-2022 mint account, created and initialized manually inside the instruction
    #[account(mut)]
    pub mint: Signer<'info>,

    /// CHECK: transfer_hook program ID
    pub transfer_hook_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, anchor_spl::token_2022::Token2022>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MintLoanTokens<'info> {
    #[account(mut)]
    pub originator: Signer<'info>,

    #[account(
        seeds = [b"loan", loan_account.loan_id.as_bytes()],
        bump = loan_account.bump,
        constraint = loan_account.originator == originator.key() @ ErrorCode::Unauthorized,
        constraint = loan_account.mint == mint.key() @ ErrorCode::MintMismatch
    )]
    pub loan_account: Account<'info, LoanAccount>,

    /// CHECK: Token-2022 mint
    #[account(mut)]
    pub mint: UncheckedAccount<'info>,

    /// CHECK: destination token account
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,

    pub token_program: Program<'info, anchor_spl::token_2022::Token2022>,
}

#[account]
#[derive(InitSpace)]
pub struct LoanAccount {
    pub originator: Pubkey,
    pub mint: Pubkey,
    #[max_len(32)]
    pub loan_id: String,
    #[max_len(64)]
    pub borrower_name: String,
    pub principal: u64,
    pub interest_rate_bps: u16,
    pub maturity: i64,
    pub paused: bool,
    pub bump: u8,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Loan ID must be ≤ 32 characters")]
    LoanIdTooLong,
    #[msg("Borrower name must be ≤ 64 characters")]
    BorrowerNameTooLong,
    #[msg("Only the loan originator can perform this action")]
    Unauthorized,
    #[msg("Provided mint does not match loan account")]
    MintMismatch,
}
