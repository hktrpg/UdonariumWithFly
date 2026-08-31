import { ObjectPreviewPayload } from 'service/object-preview-payload';
import { ObjectPreviewService } from 'service/object-preview.service';

/**
 * Shared hover / destroy wiring for Object Image Preview.
 * Use from HostListener mouseenter/leave and ngOnDestroy.
 */
export function bindObjectPreviewHover(
  preview: ObjectPreviewService,
  getId: () => string | null | undefined,
  payloadFactory: () => ObjectPreviewPayload | null,
) {
  return {
    onEnter() {
      const id = getId();
      if (!id) return;
      preview.setHovered(id, payloadFactory);
    },
    onLeave() {
      const id = getId();
      if (!id) return;
      preview.clearHovered(id);
    },
    /** Clear hover target without closing pinned/transient previews. */
    clearHover() {
      const id = getId();
      if (!id) return;
      preview.clearHovered(id);
    },
    onDestroy() {
      const id = getId();
      if (!id) return;
      preview.clearHovered(id);
      preview.closeForObject(id);
    },
  };
}
