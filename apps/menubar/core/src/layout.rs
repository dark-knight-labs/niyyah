//! Window sizing: the popup may never be taller than the screen's usable height.

/// Smallest height the shell will ask for (logical px).
pub const MIN_HEIGHT: u32 = 76;
/// Space kept free of the work area, top and bottom together (logical px): a margin under the menu bar and
/// above the Dock.
pub const SCREEN_MARGIN: u32 = 24;

/// The height (logical px) to give the window: what the page asked for, but at most the monitor's work area
/// (which already excludes the menu bar and the Dock) minus a margin. `work_area_px` is the work area height
/// in physical pixels, `scale` the monitor's scale factor. On a tiny work area the cap wins over the minimum.
pub fn fit_height(requested: u32, work_area_px: u32, scale: f64) -> u32 {
    let scale = if scale.is_finite() && scale > 0.0 { scale } else { 1.0 };
    let work = (f64::from(work_area_px) / scale).floor() as u32;
    let cap = work.saturating_sub(SCREEN_MARGIN).max(1);
    requested.max(MIN_HEIGHT).min(cap)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tall_request_is_capped_to_the_work_area_minus_the_margin() {
        // 1080p external display, work area 1055 px high (menu bar out), scale 1.
        assert_eq!(fit_height(2000, 1055, 1.0), 1031);
        // MacBook Air at scale 2: work area 1600 physical = 800 logical.
        assert_eq!(fit_height(2000, 1600, 2.0), 776);
    }

    #[test]
    fn short_displays_never_get_a_window_taller_than_their_work_area() {
        for work in [480u32, 600, 720, 768] {
            for ask in [100u32, 400, 760, 5000] {
                let h = fit_height(ask, work, 1.0);
                assert!(h <= work - SCREEN_MARGIN, "ask {ask} on {work}: got {h}");
                assert!(h >= 1);
            }
        }
        assert_eq!(fit_height(900, 480, 1.0), 456);
        assert_eq!(fit_height(900, 600, 1.0), 576);
    }

    #[test]
    fn small_requests_are_kept_but_not_below_the_minimum() {
        assert_eq!(fit_height(300, 1000, 1.0), 300);
        assert_eq!(fit_height(10, 1000, 1.0), MIN_HEIGHT);
    }

    #[test]
    fn a_work_area_smaller_than_the_minimum_still_wins() {
        assert_eq!(fit_height(500, 90, 1.0), 66);
        assert_eq!(fit_height(500, 10, 1.0), 1, "never zero, never above the area");
    }

    #[test]
    fn nonsense_scale_is_treated_as_one() {
        assert_eq!(fit_height(900, 600, 0.0), 576);
        assert_eq!(fit_height(900, 600, f64::NAN), 576);
    }
}
