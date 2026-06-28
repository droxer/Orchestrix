"use client";

import { useTranslation } from "react-i18next";
import { PageHeader } from "./PageHeader";
import { ChatIntegrationsView } from "./admin/ChatIntegrationsView";

// Channels is a standard route, not part of the admin console — it shares the
// same page chrome as MCP/Skills (shell + PageHeader) rather than borrowing the
// admin-console layout primitives.
export function ChannelsPage() {
  const { t } = useTranslation();
  return (
    <section className="channels-page flex min-h-0 flex-col overflow-y-auto bg-background">
      <PageHeader title={t("nav.channels")} />
      <div className="flex-1 p-xl max-[820px]:p-base">
        <ChatIntegrationsView />
      </div>
    </section>
  );
}
