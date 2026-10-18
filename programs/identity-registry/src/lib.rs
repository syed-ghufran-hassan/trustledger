use anchor_lang::prelude::*;

declare_id!("36TAGDektyqi6FcmhD4TZLWFh4UKyCsLwvuVo4yDNn6r");

#[program]
pub mod identity_registry {
    use super::*;

    pub fn initialize_registry(ctx: Context<InitializeRegistry>, trusted_issuer: Pubkey) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        registry.authority = ctx.accounts.authority.key();
        registry.trusted_issuer = trusted_issuer;
        registry.bump = ctx.bumps.registry;
        Ok(())
    }

    pub fn register_identity(
        ctx: Context<ManageIdentity>,
        jurisdiction: String,
        accredited: bool,
    ) -> Result<()> {
        require!(jurisdiction.len() <= 4, ErrorCode::JurisdictionTooLong);
        let identity = &mut ctx.accounts.identity;
        identity.wallet = ctx.accounts.wallet.key();
        identity.kyc_verified = true;
        identity.accredited = accredited;
        identity.sanctioned = false;
        identity.jurisdiction = jurisdiction;
        identity.bump = ctx.bumps.identity;
        Ok(())
    }

    pub fn set_sanctioned(ctx: Context<ManageIdentity>, sanctioned: bool) -> Result<()> {
        ctx.accounts.identity.sanctioned = sanctioned;
        Ok(())
    }

    pub fn revoke_identity(ctx: Context<ManageIdentity>) -> Result<()> {
        ctx.accounts.identity.kyc_verified = false;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeRegistry<'info> {
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + Registry::INIT_SPACE,
        seeds = [b"registry"],
        bump
    )]
    pub registry: Account<'info, Registry>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ManageIdentity<'info> {
    #[account(seeds = [b"registry"], bump = registry.bump)]
    pub registry: Account<'info, Registry>,

    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + Identity::INIT_SPACE,
        seeds = [b"identity", wallet.key().as_ref()],
        bump
    )]
    pub identity: Account<'info, Identity>,

    /// CHECK: wallet being registered
    pub wallet: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = authority.key() == registry.trusted_issuer @ ErrorCode::Unauthorized
    )]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct Registry {
    pub authority: Pubkey,
    pub trusted_issuer: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Identity {
    pub wallet: Pubkey,
    pub kyc_verified: bool,
    pub accredited: bool,
    pub sanctioned: bool,
    #[max_len(4)]
    pub jurisdiction: String,
    pub bump: u8,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Only the trusted issuer can perform this action")]
    Unauthorized,
    #[msg("Jurisdiction code must be 4 characters or less")]
    JurisdictionTooLong,
}
