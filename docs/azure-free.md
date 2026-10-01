# Azure free-tier portal

The deployed portal uses Azure App Service **F1**, the Azure SQL Database free
offer, and Microsoft Entra External ID. Its public origin is
`https://deck-portal-free-daac2bd8.azurewebsites.net` in resource group
`rg-deck-portal-free` (Central US). The SQL database is set to **AutoPause** when
its monthly free allowance is exhausted, so it stops serving requests until the
next month instead of billing SQL overage. The app uses the App Service-provided
HTTPS hostname; F1 does not support a custom domain.

The Azure SQL free offer has monthly limits of 100,000 vCore seconds, 32 GB data,
and 32 GB backup storage. App Service F1 has a 60 CPU-minute daily limit and 1 GB
storage. Entra External ID includes the first 50,000 monthly active users. These
are usage limits, not a guarantee that every possible usage remains free. Check
the subscription's billing and usage periodically. Free services have no SLA.

Entra hosts email/password registration, verification, and password recovery;
Deck does not require SMTP in this deployment. Google OAuth is not configured.
Email and password changes happen through Microsoft's hosted identity flow.
Deck's Security screen deletes the Deck account and synchronized SQL data after
a recent browser sign-in; it does not remove the separate Entra identity.

App settings contain SQL and Entra credentials. Do not put them in the repository
or the deployment archive. The app runs `npm run db:migrate:sql && npm run
api:start:sql`, with `DATABASE_PROVIDER=mssql`, `NODE_ENV=production`, and
`APP_URL` set to the exact public origin. SQL firewall rules admit the App
Service's published outbound IPs; if those change, update the rules before
restarting. The SQL admin account is for deployment and migrations, and its
password should be rotated from Azure Portal when needed.

To publish a code update, use Node 22 and run:

```sh
VITE_DECK_PORTAL=true npm run build
python3 scripts/package-azure-free.py
az webapp deploy -g rg-deck-portal-free -n deck-portal-free-daac2bd8 \
  --src-path deck-azure-free.zip --type zip
```

The package retains the prebuilt `dist` assets and production dependencies but
omits the remote `build` script: App Service F1 installs production packages and
therefore cannot run the dev-only TypeScript/Vite build. After deployment, check
`/healthz` (which queries SQL), `/api/v1/config`, `/app`, and the hosted sign-in
page. Use `az webapp log deployment list` if the upload reports a build error.

Official limits: [Azure SQL free offer](https://learn.microsoft.com/en-us/azure/azure-sql/database/free-offer-faq),
[App Service quotas](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/azure-subscription-service-limits),
and [Entra External ID pricing](https://learn.microsoft.com/en-us/entra/external-id/customers/faq-customers).
