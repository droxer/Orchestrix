"use client";

import { useTranslation } from "react-i18next";
import { PageHeader } from "./PageHeader";
import { ChatIntegrationsView } from "./admin/ChatIntegrationsView";

// Channels is a standard route, not part of the admin console; it shares the
// same shell + PageHeader chrome as the other top-level work pages.
export function ChannelsPage() {
  const { t } = useTranslation();
  return (
    <section id="channels-panel" className="channels-page flex min-h-0 flex-col overflow-y-auto bg-background" tabIndex={-1}>
      <PageHeader title={t("nav.channels")} />
      <div className="flex-1 p-xl max-[820px]:p-base">
        <ChatIntegrationsView />
      </div>
    </section>
  );
}
