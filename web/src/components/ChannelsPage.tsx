"use client";

import { useTranslation } from "react-i18next";
import { PageHeader } from "./PageHeader";
import { ChatIntegrationsView } from "./admin/ChatIntegrationsView";

// Channels is a standard route, not part of the admin console; it shares the
// same shell + PageHeader chrome as the other top-level work pages.
export function ChannelsPage() {
  const { t } = useTranslation();
  return (
    <section id="channels-panel" className="channels-page flex min-h-0 flex-col overflow-hidden" tabIndex={-1}>
      <PageHeader
        kicker={t("nav.channels")}
        title={t("admin.v2.title_integrations")}
        subtitle={t("admin.v2.sub_integrations")}
        titleVariant="display"
        layout="stacked"
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-xl max-[820px]:p-base">
        <ChatIntegrationsView />
      </div>
    </section>
  );
}
