"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionAdd } from "./icons";
import { PageHeader } from "./PageHeader";
import { ChatIntegrationsView } from "./admin/ChatIntegrationsView";
import { Button } from "@/components/ui/button";

// Channels is a standard route, not part of the admin console; it shares the
// same shell + PageHeader chrome as the other top-level work pages.
export function ChannelsPage() {
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);
  const [hasChannels, setHasChannels] = useState(false);

  return (
    <section
      id="channels-panel"
      className="channels-page flex min-h-0 flex-col overflow-hidden"
      tabIndex={-1}
    >
      <PageHeader
        kicker={t("nav.channels")}
        title={t("admin.v2.title_integrations")}
        subtitle={t("admin.v2.sub_integrations")}
        titleVariant="display"
        layout="stacked"
        actions={
          hasChannels ? (
            <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
              <ActionAdd size={15} aria-hidden="true" />
              <span>{t("admin.v2.chat_create")}</span>
            </Button>
          ) : null
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-xl max-[820px]:p-base">
        <ChatIntegrationsView
          createOpen={createOpen}
          onCreateOpenChange={setCreateOpen}
          onHasChannelsChange={setHasChannels}
          showToolbarCreate={false}
        />
      </div>
    </section>
  );
}
