"use client";

import { ChatIntegrationsView } from "./admin/ChatIntegrationsView";

export function ChannelsPage() {
  return (
    <section className="admin-console channels-page">
      <div className="adm-content adm-content--solo">
        <div className="adm-content-main">
          <ChatIntegrationsView />
        </div>
      </div>
    </section>
  );
}
