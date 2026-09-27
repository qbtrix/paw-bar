// components/spec-widgets/registry.ts — the components the Paw Bar draws a
// Ripple spec with, keyed by spec `type`. Created 2026-09-27.
//
// This is the renderer's whole vocabulary: a type not listed here draws
// SpecUnavailable. The first five are Ripple's standard slim atoms
// (SLIM_WIDGETS in @ripple-ui/core/manifest); product-card and form are the
// bar's own. lib/spec-manifest.ts documents the same types for the agent,
// and tests/spec-widgets.spec.svelte.ts fails if the two lists ever differ.
// There is deliberately no image widget: a model-chosen image URL is a request
// fired on render (a tracking beacon), which is why markdown images render as
// alt text too. Product images come only from the site's catalog, through
// `product-card`.

import type { SpecComponents } from '../spec/types';
import SpecText from './SpecText.svelte';
import SpecHeading from './SpecHeading.svelte';
import SpecBadge from './SpecBadge.svelte';
import SpecButton from './SpecButton.svelte';
import SpecFlex from './SpecFlex.svelte';
import SpecProducts from './SpecProducts.svelte';
import SpecForm from './SpecForm.svelte';

export const SPEC_WIDGETS: SpecComponents = {
  text: SpecText,
  heading: SpecHeading,
  badge: SpecBadge,
  button: SpecButton,
  flex: SpecFlex,
  'product-card': SpecProducts,
  form: SpecForm,
};
