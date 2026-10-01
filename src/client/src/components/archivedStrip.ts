import { html, type TemplateResult } from "lit";

/**
 * What stands in the composer slot of an archived session: it reads, but
 * takes no messages, so the slot says so and offers Restore, the row menu's
 * own action (state-diagram D8; owner, 2026-10-01: Restore goes in the
 * composer slot). Before, the composer was only disabled, with no reason and
 * no way out. The button takes no second tap while a restore is on its way: a
 * second restore of a restored session answers the code, which would send the
 * page to ask where the session went.
 */
export function renderArchivedStrip(onRestore: () => void, restoring: boolean): TemplateResult {
  return html`
    <div class="archived-strip" role="status">
      <p>This session is archived.</p>
      <button type="button" ?disabled=${restoring} @click=${onRestore}>Restore</button>
    </div>
  `;
}
