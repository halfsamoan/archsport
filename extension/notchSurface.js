import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import St from 'gi://St';
import {DESIGN} from './designTokens.js';

// The drawing area paints the tint and edge only. It does not clip BlurEffect.
// Blur is inset into the body, where its rectangular allocation stays inside
// the silhouette even at the rounded bottom corners.
export function createNotchSurface(content) {
    const surface = new St.Widget({layout_manager: new Clutter.BinLayout(),
        width: DESIGN.geometry.neckWidth, height: 8, visible: false, clip_to_allocation: true});
    const blur = new St.Widget({style_class: 'shared-notch-blur', reactive: false,
        x_expand: true, y_expand: true,
        margin_left: DESIGN.material.blurInset, margin_right: DESIGN.material.blurInset,
        margin_top: DESIGN.geometry.neckHeight + DESIGN.geometry.shoulderDepth + 2,
        margin_bottom: DESIGN.material.blurInset, visible: false});
    let hasBlur = false;
    try {
        const properties = new Set(Shell.BlurEffect.list_properties().map(p => p.name));
        if (!['mode', 'radius', 'brightness'].every(name => properties.has(name)))
            throw new Error('GNOME BlurEffect properties unavailable');
        blur.add_effect(new Shell.BlurEffect({mode: Shell.BlurMode.BACKGROUND,
            radius: DESIGN.material.blurRadius, brightness: DESIGN.material.blurBrightness}));
        surface.add_child(blur);
        hasBlur = true;
    } catch (error) {
        console.warn(`[notchSurface] backdrop blur unavailable: ${error.message}`);
        blur.destroy();
    }

    const shape = new St.DrawingArea({reactive: false, x_expand: true, y_expand: true});
    shape.connect('repaint', area => {
        const [width, height] = area.get_surface_size();
        if (width < 1 || height < 1) return;
        const context = area.get_context();
        const center = width / 2;
        const neck = Math.min(DESIGN.geometry.neckWidth, Math.max(1, width - 24));
        const compact = height <= 60;
        const shoulder = Math.min(compact ? DESIGN.geometry.compactShoulder :
            DESIGN.geometry.neckHeight + DESIGN.geometry.shoulderDepth,
        Math.max(DESIGN.geometry.neckHeight, height - 12));
        const radius = Math.min(DESIGN.radius.surface, Math.max(1, height - shoulder));
        const start = center - neck / 2;
        const end = center + neck / 2;
        context.moveTo(start, 0);
        context.lineTo(end, 0);
        context.lineTo(end, DESIGN.geometry.neckHeight);
        context.curveTo(end + 2, shoulder - 3, width - 28, shoulder - 8, width, shoulder);
        context.lineTo(width, height - radius);
        context.curveTo(width, height - radius / 2, width - radius / 2, height,
            width - radius, height);
        context.lineTo(radius, height);
        context.curveTo(radius / 2, height, 0, height - radius / 2, 0, height - radius);
        context.lineTo(0, shoulder);
        context.curveTo(28, shoulder - 8, start - 2, shoulder - 3, start, DESIGN.geometry.neckHeight);
        context.closePath();
        context.setSourceRGBA(0.035, 0.039, 0.047, DESIGN.material.tintAlpha);
        context.fillPreserve();
        context.setSourceRGBA(1, 1, 1, DESIGN.material.highlightAlpha);
        context.setLineWidth(1);
        context.stroke();
    });
    surface.add_child(shape);
    const neckHit = new St.Widget({reactive: true, can_focus: false,
        x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.FILL,
        y_expand: true, width: DESIGN.geometry.neckWidth});
    surface.add_child(neckHit);
    const shoulderHits = [0.1, 0.3, 0.65].map(() => {
        const hit = new St.Widget({reactive: true, can_focus: false,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.FILL,
            y_expand: true});
        surface.add_child(hit);
        return hit;
    });
    const bodyHit = new St.Widget({reactive: true, can_focus: false,
        x_expand: true, y_expand: true});
    surface.add_child(bodyHit);
    const bottomHit = new St.Widget({reactive: true, can_focus: false,
        x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.FILL,
        y_expand: true});
    surface.add_child(bottomHit);
    const updateHitRegions = () => {
        const width = Math.max(1, surface.width);
        const height = Math.max(1, surface.height);
        const neck = Math.min(DESIGN.geometry.neckWidth, Math.max(1, width - 24));
        const shoulder = height <= 60 ? DESIGN.geometry.compactShoulder :
            DESIGN.geometry.neckHeight + DESIGN.geometry.shoulderDepth;
        const radius = Math.min(DESIGN.radius.surface, Math.max(1, height - shoulder));
        neckHit.width = neck;
        neckHit.margin_bottom = Math.max(0, height - DESIGN.geometry.neckHeight);
        const bandHeight = (shoulder - DESIGN.geometry.neckHeight) / shoulderHits.length;
        for (const [index, hit] of shoulderHits.entries()) {
            hit.width = Math.round(neck + (width - neck) * [0.1, 0.3, 0.65][index]);
            const top = Math.round(DESIGN.geometry.neckHeight + index * bandHeight);
            hit.margin_top = top;
            hit.margin_bottom = Math.max(0, height - Math.ceil(top + bandHeight));
        }
        bodyHit.margin_top = shoulder;
        bodyHit.margin_bottom = radius;
        bottomHit.width = Math.max(1, width - 2 * radius);
        bottomHit.margin_top = Math.max(0, height - radius);
    };
    surface.connect('notify::height', () => {
        if (hasBlur) blur.visible = surface.height > 60;
        updateHitRegions();
        shape.queue_repaint();
    });
    surface.connect('notify::width', () => {
        updateHitRegions();
        shape.queue_repaint();
    });
    content.x_expand = true;
    content.y_expand = true;
    surface.add_child(content);
    updateHitRegions();
    return surface;
}
