import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {DESIGN} from './designTokens.js';
import {notchGeometry} from './dockModel.js';

// The surface continues the top panel as one opaque slab: concave ears where it
// leaves the panel, vertical sides, a rounded bottom. Its colour is read from the
// panel so the seam disappears; a faint downward lift and key line give material.
export function createNotchSurface(content) {
    const surface = new St.Widget({layout_manager: new Clutter.BinLayout(),
        width: DESIGN.geometry.neckWidth, height: DESIGN.geometry.seedHeight,
        visible: false, clip_to_allocation: true});
    let base = [0, 0, 0];
    const readPanelColor = () => {
        try {
            const color = Main.panel.get_theme_node().get_background_color();
            // A translucent panel theme cannot be matched; fall back to black.
            base = color.alpha === 255 ? [color.red / 255, color.green / 255, color.blue / 255] : [0, 0, 0];
        } catch (_error) {
            base = [0, 0, 0];
        }
    };
    readPanelColor();

    const shape = new St.DrawingArea({reactive: false, x_expand: true, y_expand: true});
    shape.connect('repaint', area => {
        const [width, height] = area.get_surface_size();
        if (width < 1 || height < 1) return;
        const context = area.get_context();
        const {ear, radius, sliver} = notchGeometry(height, width);
        if (sliver) {
            // The seed sliver is the panel edge pulled down; no corners at this size.
            context.rectangle(0, 0, width, height);
        } else {
            context.moveTo(0, 0);
            context.arc(0, ear, ear, -Math.PI / 2, 0);
            context.lineTo(ear, height - radius);
            context.arcNegative(ear + radius, height - radius, radius, Math.PI, Math.PI / 2);
            context.lineTo(width - ear - radius, height);
            context.arcNegative(width - ear - radius, height - radius, radius, Math.PI / 2, 0);
            context.lineTo(width - ear, ear);
            context.arc(width, ear, ear, Math.PI, 1.5 * Math.PI);
            context.closePath();
        }
        const lift = DESIGN.material.lift;
        const fill = new Cairo.LinearGradient(0, 0, 0, height);
        fill.addColorStopRGB(0, ...base);
        fill.addColorStopRGB(1, ...base.map(channel => channel + (1 - channel) * lift));
        context.setSource(fill);
        if (sliver) {
            context.fill();
        } else {
            context.fillPreserve();
            // Key line half a pixel inside the edge, on the ears, sides and bottom only:
            // the top edge belongs to the panel.
            context.newPath();
            context.arc(0, ear, ear + 0.5, -Math.PI / 2, 0);
            context.lineTo(ear + 0.5, height - radius);
            context.arcNegative(ear + radius, height - radius, radius - 0.5, Math.PI, Math.PI / 2);
            context.lineTo(width - ear - radius, height - 0.5);
            context.arcNegative(width - ear - radius, height - radius, radius - 0.5, Math.PI / 2, 0);
            context.lineTo(width - ear - 0.5, ear);
            context.arc(width, ear, ear + 0.5, Math.PI, 1.5 * Math.PI);
            context.setSourceRGBA(1, 1, 1, DESIGN.material.keyLineAlpha);
            context.setLineWidth(1);
            context.stroke();
        }
        // GNOME Shell's own repaint handlers free the Cairo context immediately.
        context.$dispose();
    });
    surface.add_child(shape);
    Main.panel.connectObject('style-changed', () => {
        readPanelColor();
        shape.queue_repaint();
    }, surface);

    // Two reactive regions approximate the slab without the ears.
    const bodyHit = new St.Widget({reactive: true, can_focus: false, x_expand: true, y_expand: true});
    const bottomHit = new St.Widget({reactive: true, can_focus: false,
        x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.FILL, y_expand: true});
    surface.add_child(bodyHit);
    surface.add_child(bottomHit);
    const updateHitRegions = () => {
        const width = Math.max(1, surface.width);
        const height = Math.max(1, surface.height);
        const {ear, radius, sliver} = notchGeometry(height, width);
        bodyHit.margin_left = bodyHit.margin_right = sliver ? 0 : ear;
        bodyHit.margin_bottom = sliver ? 0 : radius;
        bottomHit.width = Math.max(1, width - 2 * (ear + radius));
        bottomHit.margin_top = Math.max(0, height - radius);
    };
    // A theme reload (e.g. light/dark switch) resets margin_* to the CSS value 0,
    // which would make the transparent ears reactive until the next resize.
    for (const hit of [bodyHit, bottomHit])
        hit.connect('style-changed', updateHitRegions);
    surface.connect('notify::height', () => {
        updateHitRegions();
        shape.queue_repaint();
    });
    surface.connect('notify::width', () => {
        updateHitRegions();
        shape.queue_repaint();
    });
    // Content keeps its final size and is revealed by the growing slab instead of
    // being relaid out every frame of the morph. BinLayout would clamp it to the
    // slab, so a fixed-layout holder allocates its preferred size, top-centred.
    const holder = new Clutter.Actor({layout_manager: new Clutter.FixedLayout(), x_expand: true, y_expand: true});
    content.add_constraint(new Clutter.AlignConstraint({source: holder,
        align_axis: Clutter.AlignAxis.X_AXIS, factor: 0.5}));
    holder.add_child(content);
    surface.add_child(holder);
    surface._notchContent = content;
    updateHitRegions();
    return surface;
}
