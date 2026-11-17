export type HiddenRemoval = { removedNodes: number; reverted: boolean };

/**
 * Deliberately self-contained so this exact function can later run inside a
 * browser with page.evaluate(). Inline mode avoids computed-style/layout APIs.
 */
export function pruneHiddenDocument(input: {
  document?: Document;
  mode: 'inline' | 'rendered';
  sharpAsks: ReadonlyArray<{ source: string; flags: string }>;
}): HiddenRemoval {
  const doc = input.document ?? globalThis.document;
  const ignored = 'script, style, noscript, svg, template';
  const normalize = (text: string) => text.replace(/\s+/gu, ' ').trim();
  const readingRoot = () => {
    const main = doc.querySelector('main');
    if (main) return main;
    const articles = doc.querySelectorAll('article');
    return articles.length === 1 ? articles[0] : doc.body;
  };
  const readableText = (root: Element) => {
    const copy = root.cloneNode(true) as Element;
    copy.querySelectorAll(ignored).forEach((element) => element.remove());
    return normalize(copy.textContent ?? '');
  };
  const hasClass = (element: Element, name: string) => element.classList.contains(name);
  const interactiveController = (element: Element) => {
    const tagName = element.tagName.toLowerCase();
    const role = element.getAttribute('role')?.toLowerCase();
    return tagName === 'summary' || role === 'tab' || element.hasAttribute('aria-expanded') || element.closest('.vp-code-group-tabs') !== null;
  };
  const controlledIds = new Set(
    Array.from(doc.querySelectorAll('[aria-controls]'))
      .filter(interactiveController)
      .flatMap((control) => (control.getAttribute('aria-controls') ?? '').trim().split(/\s+/u))
      .filter(Boolean)
  );
  const controlledPanel = (element: Element) => {
    const id = element.getAttribute('id');
    return id !== null && controlledIds.has(id);
  };
  // Bootstrap-style toggles name their panel in href, data-target or data-bs-target.
  const toggledIds = new Set(
    Array.from(doc.querySelectorAll('[data-toggle], [data-bs-toggle]'))
      .filter((control) => ['data-toggle', 'data-bs-toggle'].some((name) => /^(?:tab|pill|collapse)$/iu.test(control.getAttribute(name)?.trim() ?? '')))
      .flatMap((control) => [control.getAttribute('href'), control.getAttribute('data-target'), control.getAttribute('data-bs-target')])
      .map((target) => target?.trim() ?? '')
      .filter((target) => target.startsWith('#') && target.length > 1)
      .map((target) => target.slice(1))
  );
  const toggledPanel = (element: Element) => {
    const id = element.getAttribute('id');
    return id !== null && toggledIds.has(id);
  };
  const readerOpenable = (element: Element) => {
    if (element.getAttribute('hidden')?.trim().toLowerCase() === 'until-found') return true;
    if (element.tagName.toLowerCase() === 'details') return true;
    if (element.getAttribute('role')?.toLowerCase() === 'tabpanel' || controlledPanel(element)) return true;
    if (hasClass(element, 'tabItem') && element.closest('.tabs-container')) return true; // Docusaurus
    if (element.closest('.vp-code-group') && (hasClass(element, 'blocks') || controlledPanel(element))) return true; // VitePress
    if (element.parentElement && hasClass(element.parentElement, 'blocks') && element.parentElement.closest('.vp-code-group')) return true; // VitePress code pane
    if (hasClass(element, 'tabbed-block') && element.closest('.tabbed-set') !== null) return true; // MkDocs Material pane
    return hasClass(element, 'tabbed-content') && element.closest('.tabbed-set') !== null; // MkDocs Material
  };
  const underOpenable = (element: HTMLElement) => {
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) if (readerOpenable(ancestor)) return true;
    return false;
  };
  const attributeHidden = (element: HTMLElement) =>
    element.hasAttribute('hidden') || element.getAttribute('aria-hidden')?.trim().toLowerCase() === 'true';
  const inlineHidden = (element: HTMLElement) => {
    if (attributeHidden(element)) return true;
    const style = (element as HTMLElement & { style?: CSSStyleDeclaration }).style;
    if (!style) return false;
    if (style.display.toLowerCase() === 'none' || style.visibility.toLowerCase() === 'hidden') return true;
    if (style.opacity === '0' || style.fontSize === '0' || style.fontSize === '0px') return true;
    const overflowHidden = [style.overflow, style.overflowX, style.overflowY].some((value) => value.toLowerCase() === 'hidden' || value.toLowerCase() === 'clip');
    const width = Number.parseFloat(style.width);
    const height = Number.parseFloat(style.height);
    if (overflowHidden && (width === 0 || height === 0)) return true;
    const positioned = /^(?:absolute|fixed|relative|sticky)$/iu.test(style.position);
    return positioned && [style.left, style.top].some((value) => Number.parseFloat(value) <= -1000);
  };
  const hidden = (element: HTMLElement) => {
    if (input.mode === 'inline') return inlineHidden(element);
    if (attributeHidden(element)) return true;
    const style = doc.defaultView?.getComputedStyle(element);
    if (!style) return inlineHidden(element);
    // A reader-openable ancestor's own hiding is inherited here; its panel is revealed, so the child's own state decides.
    const parentStyle = element.parentElement ? doc.defaultView?.getComputedStyle(element.parentElement) : undefined;
    const inheritedFromPanel = underOpenable(element);
    const hiddenVisibility = style.visibility === 'hidden' && !(inheritedFromPanel && style.visibility === parentStyle?.visibility);
    const hiddenFontSize = (style.fontSize === '0px') && !(inheritedFromPanel && style.fontSize === parentStyle?.fontSize);
    if (style.display === 'none' || hiddenVisibility || style.opacity === '0' || hiddenFontSize) return true;
    // A child of a display:none panel has no layout, so its own offset is the only signal.
    const positioned = /^(?:absolute|fixed|relative|sticky)$/iu.test(style.position);
    if (positioned && [style.left, style.top].some((value) => Number.parseFloat(value) <= -1000)) return true;
    const overflowHidden = [style.overflow, style.overflowX, style.overflowY]
      .some((value) => value === 'hidden' || value === 'clip');
    const rect = element.getBoundingClientRect();
    if (overflowHidden && (rect.width === 0 || rect.height === 0)) return true;
    return rect.right <= -1000 || rect.bottom <= -1000;
  };
  const visibleSiblingWithSameClasses = (element: HTMLElement) => {
    const classes = [...element.classList].sort();
    if (classes.length === 0) return false;
    return [...element.parentElement?.children ?? []].some((sibling) => {
      if (sibling === element || sibling.tagName !== element.tagName) return false;
      if ([...sibling.classList].sort().join('\u0000') !== classes.join('\u0000')) return false;
      return !hidden(sibling as HTMLElement);
    });
  };
  const accordionPanel = (element: HTMLElement) => {
    const previous = element.previousElementSibling;
    return previous !== null && (
      previous.matches('button[aria-expanded], [role="button"][aria-expanded]') ||
      previous.querySelector('button[aria-expanded], [role="button"][aria-expanded]') !== null
    );
  };
  const hasOtherInlineHardHide = (element: HTMLElement) => {
    if (element.getAttribute('aria-hidden')?.trim().toLowerCase() === 'true') return true;
    const style = element.style;
    if (!style) return false;
    if (style.visibility.toLowerCase() === 'hidden' || style.opacity === '0' || style.fontSize === '0' || style.fontSize === '0px') return true;
    const overflowHidden = [style.overflow, style.overflowX, style.overflowY]
      .some((value) => value.toLowerCase() === 'hidden' || value.toLowerCase() === 'clip');
    if (overflowHidden && (Number.parseFloat(style.width) === 0 || Number.parseFloat(style.height) === 0)) return true;
    return /^(?:absolute|fixed|relative|sticky)$/iu.test(style.position) && [style.left, style.top].some((value) => Number.parseFloat(value) <= -1000);
  };
  const hasOtherRenderedHardHide = (element: HTMLElement) => {
    if (hasOtherInlineHardHide(element)) return true;
    const hadHidden = element.hasAttribute('hidden');
    const display = element.style?.getPropertyValue('display') ?? '';
    const displayPriority = element.style?.getPropertyPriority('display') ?? '';
    try {
      if (hadHidden) element.removeAttribute('hidden');
      if (display.toLowerCase() === 'none') element.style?.removeProperty('display');
      const style = doc.defaultView?.getComputedStyle(element);
      if (!style || style.visibility === 'hidden' || style.opacity === '0' || style.fontSize === '0px') return true;
      const overflowHidden = [style.overflow, style.overflowX, style.overflowY]
        .some((value) => value === 'hidden' || value === 'clip');
      const rect = element.getBoundingClientRect();
      // A display:none box has no geometry, so only the display keep case remains and its zero size is not a hard hide.
      return (style.display !== 'none' && overflowHidden && (rect.width === 0 || rect.height === 0)) || rect.right <= -1000 || rect.bottom <= -1000;
    } finally {
      if (display.toLowerCase() === 'none') element.style?.setProperty('display', display, displayPriority);
      if (hadHidden) element.setAttribute('hidden', '');
    }
  };
  // These real-world patterns only excuse the panel itself when it is hidden by
  // an attribute or inline display. They do not make a wrapper or descendants visible.
  const displayHidden = (element: HTMLElement) => {
    if (element.hasAttribute('hidden') || element.style?.display.toLowerCase() === 'none') return true;
    return input.mode === 'rendered' && doc.defaultView?.getComputedStyle(element).display === 'none';
  };
  const selfOpenable = (element: HTMLElement) =>
    displayHidden(element) &&
    !(input.mode === 'rendered' ? hasOtherRenderedHardHide(element) : hasOtherInlineHardHide(element)) &&
    (visibleSiblingWithSameClasses(element) || accordionPanel(element) || toggledPanel(element));
  const root = readingRoot();
  if (!root) return { removedNodes: 0, reverted: false };
  const elements = [root as HTMLElement, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
  const openableElements = elements.filter(readerOpenable);
  // Sentence pieces too: the egress pattern is anchored to a sentence start, so a later sentence must still be seen.
  const sharpHeuristicPanel = (element: HTMLElement) => {
    const text = normalize(element.textContent ?? '');
    const pieces = [text, ...text.split(/(?<=[.!?;:])\s+/u)];
    return input.sharpAsks.some((ask) => {
      const pattern = new RegExp(ask.source, ask.flags);
      return pieces.some((piece) => pattern.test(piece));
    });
  };
  // Heuristic keeps are guesses about markup that anyone can copy, so a sharp ask inside one stays hidden.
  const selfOpenableElements = elements.filter(selfOpenable).filter((element) => readerOpenable(element) || !sharpHeuristicPanel(element));
  const protectedElements = new Set<Element>(openableElements);
  selfOpenableElements.forEach((element) => protectedElements.add(element));
  // Readability commonly ignores hidden panel markup. Reveal only the openable
  // element itself; its descendants are judged on their own.
  for (const protectedElement of protectedElements) {
    const selfOnly = selfOpenableElements.includes(protectedElement as HTMLElement) && !readerOpenable(protectedElement);
    protectedElement.removeAttribute('hidden');
    if (protectedElement.getAttribute('aria-hidden')?.trim().toLowerCase() === 'true') protectedElement.removeAttribute('aria-hidden');
    const style = (protectedElement as HTMLElement & { style?: CSSStyleDeclaration }).style;
    if (!style) continue;
    if (style.display.toLowerCase() === 'none') style.removeProperty('display');
    if (selfOnly) continue;
    if (style.visibility.toLowerCase() === 'hidden') style.removeProperty('visibility');
    if (style.opacity === '0') style.removeProperty('opacity');
    if (style.fontSize === '0' || style.fontSize === '0px') style.removeProperty('font-size');
  }
  const visibleDescendantAncestors = new Set<Element>();
  const visibleOverrideSubtrees = new Set<Element>();
  const readabilityVisibleOverrides: HTMLElement[] = [];
  if (input.mode === 'inline') {
    const inlineOverride = (element: HTMLElement) => {
      const style = (element as HTMLElement & { style?: CSSStyleDeclaration }).style;
      if (!style) return false;
      const visibilityOverride = style.visibility.toLowerCase() === 'visible';
      const fontSizeOverride = Number.parseFloat(style.fontSize) > 0;
      if (!visibilityOverride && !fontSizeOverride) return false;
      let inheritedVisibility: string | undefined;
      let inheritedFontSize: string | undefined;
      let ancestor = element.parentElement as HTMLElement | null;
      while (ancestor) {
        const ancestorStyle = (ancestor as HTMLElement & { style?: CSSStyleDeclaration }).style;
        if (
          attributeHidden(ancestor) ||
          ancestorStyle?.display.toLowerCase() === 'none' ||
          ancestorStyle?.opacity === '0'
        ) return false;
        if (inheritedVisibility === undefined && ancestorStyle?.visibility) inheritedVisibility = ancestorStyle.visibility.toLowerCase();
        if (inheritedFontSize === undefined && ancestorStyle?.fontSize) inheritedFontSize = ancestorStyle.fontSize;
        if (ancestor === root) break;
        ancestor = ancestor.parentElement;
      }
      const effectiveVisibility = style.visibility.toLowerCase() || inheritedVisibility;
      const effectiveFontSize = style.fontSize || inheritedFontSize;
      if (
        effectiveVisibility === 'hidden' ||
        effectiveVisibility === 'collapse' ||
        effectiveFontSize === '0' ||
        effectiveFontSize === '0px'
      ) return false;
      const overridesVisibility = visibilityOverride && (inheritedVisibility === 'hidden' || inheritedVisibility === 'collapse');
      const overridesFontSize = fontSizeOverride && (inheritedFontSize === '0' || inheritedFontSize === '0px');
      return overridesVisibility || overridesFontSize;
    };
    for (const element of elements) {
      if (!inlineOverride(element)) continue;
      visibleOverrideSubtrees.add(element);
      element.querySelectorAll('*').forEach((descendant) => visibleOverrideSubtrees.add(descendant));
      if (element.style.visibility.toLowerCase() === 'visible') readabilityVisibleOverrides.push(element);
      let ancestor = element.parentElement;
      while (ancestor) {
        visibleDescendantAncestors.add(ancestor);
        if (ancestor === root) break;
        ancestor = ancestor.parentElement;
      }
    }
  }
  if (input.mode === 'rendered') {
    const visibleInLayout = (element: HTMLElement) => {
      const style = doc.defaultView?.getComputedStyle(element);
      if (!style || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || style.fontSize === '0px') return false;
      let ancestor = element.parentElement as HTMLElement | null;
      while (ancestor) {
        const ancestorStyle = doc.defaultView?.getComputedStyle(ancestor);
        if (
          ancestor.hasAttribute('hidden') ||
          ancestor.getAttribute('aria-hidden')?.trim().toLowerCase() === 'true' ||
          ancestorStyle?.display === 'none' ||
          ancestorStyle?.opacity === '0'
        ) return false;
        if (ancestor === root) break;
        ancestor = ancestor.parentElement;
      }
      return true;
    };
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.right <= -1000 || rect.bottom <= -1000 || !visibleInLayout(element)) continue;
      let ancestor = element.parentElement;
      while (ancestor) {
        visibleDescendantAncestors.add(ancestor);
        if (ancestor === root) break;
        ancestor = ancestor.parentElement;
      }
    }
  }
  const hiddenSiblingOfVisibleOverride = (element: HTMLElement) => {
    if (input.mode !== 'inline' || visibleOverrideSubtrees.has(element)) return false;
    let ancestor = element.parentElement as HTMLElement | null;
    while (ancestor) {
      if (visibleDescendantAncestors.has(ancestor) && inlineHidden(ancestor)) return true;
      if (ancestor === root) break;
      ancestor = ancestor.parentElement;
    }
    return false;
  };
  const candidates = elements.filter(
    (element) =>
      (hidden(element) || hiddenSiblingOfVisibleOverride(element)) &&
      !protectedElements.has(element) &&
      !visibleDescendantAncestors.has(element)
  );
  const candidateSet = new Set(candidates);
  const roots = candidates.filter((element) => {
    let ancestor = element.parentElement;
    while (ancestor) {
      if (candidateSet.has(ancestor as HTMLElement)) return false;
      if (ancestor === root) break;
      ancestor = ancestor.parentElement;
    }
    return true;
  });
  const relocateVisibleOverrides = () => {
    for (const visibleOverride of readabilityVisibleOverrides) {
      let hiddenAncestor = visibleOverride.parentElement as HTMLElement | null;
      let outermostHiddenAncestor: HTMLElement | null = null;
      while (hiddenAncestor && hiddenAncestor !== root) {
        if (hiddenAncestor.style.visibility.toLowerCase() === 'hidden') {
          outermostHiddenAncestor = hiddenAncestor;
        }
        hiddenAncestor = hiddenAncestor.parentElement;
      }
      outermostHiddenAncestor?.after(visibleOverride);
    }
  };
  if (roots.length === 0) {
    relocateVisibleOverrides();
    return { removedNodes: 0, reverted: false };
  }
  const before = readableText(root);
  const clone = root.cloneNode(true) as Element;
  const cloneRoots = roots.map((element) => {
    const path: number[] = [];
    let cursor: Element | null = element;
    while (cursor && cursor !== root) {
      const parent: Element | null = cursor.parentElement;
      if (!parent) break;
      path.unshift(Array.prototype.indexOf.call(parent.children, cursor));
      cursor = parent;
    }
    let cloneCursor: Element | null = clone;
    for (const index of path) cloneCursor = cloneCursor?.children[index] ?? null;
    return cloneCursor;
  });
  cloneRoots.forEach((element) => element?.remove());
  const after = roots.includes(root as HTMLElement) ? '' : readableText(clone);
  if (before.length > 0 && after.length < before.length / 2) {
    // The valve exists for pages that hide their body until scripts run. Keep that
    // text, but a hidden block that carries a sharp ask is still removed.
    const askRoots = roots.filter((element) => element !== root && sharpHeuristicPanel(element));
    askRoots.forEach((element) => element.remove());
    if (askRoots.length > 0) relocateVisibleOverrides();
    return { removedNodes: askRoots.length, reverted: true };
  }
  if (root === doc.body && roots.includes(root as HTMLElement)) return { removedNodes: 0, reverted: false };
  roots.forEach((element) => element.remove());
  relocateVisibleOverrides();
  return { removedNodes: roots.length, reverted: false };
}
