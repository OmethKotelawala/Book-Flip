/**
 * NSBM Annual Report 2025-2026 - Professional 3D Flipbook Engine
 * Powered by PDF.js and CSS 3D Transforms
 */

(function () {
  'use strict';

  // Set PDF.js worker
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  // Primary and fallback PDF URLs
  const PDF_SOURCES = [
    '/api/pdf-proxy',
    'https://raw.githubusercontent.com/OmethKotelawala/NSBM-AR/main/NSBM%20AR%202025-2026%20Book%20(1).pdf',
    'NSBM-AR-2025-2026.pdf', // Local offline fallback
    'https://github.com/OmethKotelawala/NSBM-AR/raw/main/NSBM%20AR%202025-2026%20Book%20(1).pdf',
    'https://corsproxy.io/?url=' + encodeURIComponent('https://raw.githubusercontent.com/OmethKotelawala/NSBM-AR/main/NSBM%20AR%202025-2026%20Book%20(1).pdf')
  ];

  // State
  const state = {
    pdfDoc: null,
    totalPages: 0,
    currentPage: 1, // in spread mode, currentPage represents the left page of spread (or 1 for cover)
    isSingleSpread: false, // auto-detected or manual override
    userForcedSingle: false,
    zoomLevel: 1.0,
    panX: 0,
    panY: 0,
    isPanning: false,
    panStartX: 0,
    panStartY: 0,
    isFlipping: false,
    soundEnabled: true,
    autoplayActive: false,
    autoplayTimer: null,
    searchIndex: [], // [{ pageNum: 1, text: "..." }]
    searchQuery: '',
    searchResults: [],
    pageRenderCache: new Map(), // pageNum -> OffscreenCanvas or HTMLCanvasElement
    pageThumbCache: new Map(),
    dragState: null,
    audioCtx: null
  };

  // DOM Elements
  const els = {
    appContainer: document.getElementById('app-container'),
    loadingOverlay: document.getElementById('loading-overlay'),
    loaderStatus: document.getElementById('loader-status'),
    loadProgress: document.getElementById('load-progress'),
    pageInput: document.getElementById('page-input'),
    pageTotal: document.getElementById('page-total'),
    btnPrev: document.getElementById('btn-prev'),
    btnNext: document.getElementById('btn-next'),
    btnFirst: document.getElementById('btn-first'),
    btnLast: document.getElementById('btn-last'),
    stage: document.getElementById('stage'),
    bookViewport: document.getElementById('book-viewport'),
    book: document.getElementById('book'),
    pageLeftWrapper: document.getElementById('page-left-wrapper'),
    pageRightWrapper: document.getElementById('page-right-wrapper'),
    canvasLeft: document.getElementById('canvas-left'),
    canvasRight: document.getElementById('canvas-right'),
    numLeft: document.getElementById('num-left'),
    numRight: document.getElementById('num-right'),
    stackLeft: document.getElementById('stack-left'),
    stackRight: document.getElementById('stack-right'),
    flipCastShadow: document.getElementById('flip-cast-shadow'),
    flipLeaf: document.getElementById('flip-leaf'),
    leafFront: document.getElementById('leaf-front'),
    leafBack: document.getElementById('leaf-back'),
    canvasLeafFront: document.getElementById('canvas-leaf-front'),
    canvasLeafBack: document.getElementById('canvas-leaf-back'),
    shadowFront: document.getElementById('shadow-front'),
    shadowBack: document.getElementById('shadow-back'),
    dragZoneRight: document.getElementById('drag-zone-right'),
    dragZoneLeft: document.getElementById('drag-zone-left'),
    btnToggleSearch: document.getElementById('btn-toggle-search'),
    searchPanel: document.getElementById('search-panel'),
    btnCloseSearch: document.getElementById('btn-close-search'),
    searchQueryInput: document.getElementById('search-query'),
    btnSearchExec: document.getElementById('btn-search-exec'),
    searchStats: document.getElementById('search-stats'),
    searchResultsList: document.getElementById('search-results-list'),
    btnToggleOutline: document.getElementById('btn-toggle-outline'),
    outlinePanel: document.getElementById('outline-panel'),
    btnCloseOutline: document.getElementById('btn-close-outline'),
    outlineList: document.getElementById('outline-list'),
    btnToggleThumbs: document.getElementById('btn-toggle-thumbs'),
    thumbsDrawer: document.getElementById('thumbs-drawer'),
    btnCloseThumbs: document.getElementById('btn-close-thumbs'),
    thumbsContainer: document.getElementById('thumbs-container'),
    btnToggleSpread: document.getElementById('btn-toggle-spread'),
    btnZoomIn: document.getElementById('btn-zoom-in'),
    btnZoomOut: document.getElementById('btn-zoom-out'),
    btnZoomVal: document.getElementById('btn-zoom-val'),
    zoomPercent: document.getElementById('zoom-percent'),
    zoomFloatHint: document.getElementById('zoom-float-hint'),
    btnZoomResetHint: document.getElementById('btn-zoom-reset-hint'),
    btnSound: document.getElementById('btn-sound'),
    soundIconOn: document.getElementById('sound-icon-on'),
    soundIconOff: document.getElementById('sound-icon-off'),
    btnFullscreen: document.getElementById('btn-fullscreen'),
    fsIconEnter: document.getElementById('fs-icon-enter'),
    fsIconExit: document.getElementById('fs-icon-exit'),
    btnAutoplay: document.getElementById('btn-autoplay'),
    playIcon: document.getElementById('play-icon'),
    pauseIcon: document.getElementById('pause-icon')
  };

  /* --------------------------------------------------------------------------
     Realistic Paper Turn Sound (Synthesized with Web Audio API)
     -------------------------------------------------------------------------- */
  function playPaperTurnSound() {
    if (!state.soundEnabled) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      if (!state.audioCtx) {
        state.audioCtx = new AudioContext();
      }
      if (state.audioCtx.state === 'suspended') {
        state.audioCtx.resume();
      }

      const ctx = state.audioCtx;
      const bufferSize = ctx.sampleRate * 0.18; // 180ms crisp swoosh
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = buffer.getChannelData(0);

      for (let i = 0; i < bufferSize; i++) {
        // Pink/brown noise curve for organic paper friction
        output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.45));
      }

      const whiteNoise = ctx.createBufferSource();
      whiteNoise.buffer = buffer;

      // Bandpass filter to simulate page whoosh
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1400, ctx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(350, ctx.currentTime + 0.18);
      filter.Q.setValueAtTime(1.8, ctx.currentTime);

      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(0.35, ctx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.18);

      whiteNoise.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(ctx.destination);

      whiteNoise.start();
    } catch (e) {
      console.warn('Audio synthesis not allowed before user interaction:', e);
    }
  }

  /* --------------------------------------------------------------------------
     Initialize & Load PDF Document
     -------------------------------------------------------------------------- */
  async function initPDF() {
    let loaded = false;
    for (let i = 0; i < PDF_SOURCES.length; i++) {
      const url = PDF_SOURCES[i];
      try {
        els.loaderStatus.textContent = `Connecting to NSBM Annual Report... (source ${i + 1}/${PDF_SOURCES.length})`;
        els.loadProgress.style.width = '30%';

        const loadingTask = pdfjsLib.getDocument({
          url: url,
          cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
          cMapPacked: true,
          enableXfa: true
        });

        loadingTask.onProgress = function (progress) {
          if (progress.total > 0) {
            const percent = Math.min(95, Math.round((progress.loaded / progress.total) * 100));
            els.loadProgress.style.width = `${percent}%`;
            els.loaderStatus.textContent = `Loading Document (${percent}%)...`;
          }
        };

        state.pdfDoc = await loadingTask.promise;
        state.totalPages = state.pdfDoc.numPages;
        els.loadProgress.style.width = '100%';
        els.loaderStatus.textContent = `Preparing 3D Pages (${state.totalPages} pages)...`;
        loaded = true;
        break;
      } catch (err) {
        console.warn(`Failed to load PDF from source: ${url}`, err);
      }
    }

    if (!loaded) {
      els.loaderStatus.innerHTML = '<span style="color:#ef4444">Error loading PDF. Please check connection.</span>';
      return;
    }

    // UI Initial setup
    els.pageTotal.textContent = state.totalPages;
    els.pageInput.max = state.totalPages;

    // Check screen width for single vs spread layout
    checkResponsiveLayout();

    // Render initial pages
    await renderCurrentSpread();

    // Hide loader overlay
    setTimeout(() => {
      els.loadingOverlay.classList.add('fade-out');
    }, 400);

    // Build background indexes
    buildThumbnailsDrawer();
    buildTableOfContents();
    indexDocumentForSearch();
  }

  /* --------------------------------------------------------------------------
     Layout & Geometry Calculations
     -------------------------------------------------------------------------- */
  function checkResponsiveLayout() {
    const isMobile = window.innerWidth <= 840;
    if (isMobile || state.userForcedSingle) {
      state.isSingleSpread = true;
      els.book.classList.add('single-mode');
    } else {
      state.isSingleSpread = false;
      els.book.classList.remove('single-mode');
    }
    updateDimensions();
  }

  function updateDimensions() {
    const stageH = els.stage.clientHeight - 40;
    const stageW = els.stage.clientWidth - 80;
    const targetH = Math.min(stageH, 860);
    const aspect = 0.707; // A4 aspect
    const singleW = targetH * aspect;

    if (!state.isSingleSpread && singleW * 2 > stageW) {
      // Fit spread width inside viewport
      const fitSingleW = (stageW * 0.95) / 2;
      const fitH = fitSingleW / aspect;
      document.documentElement.style.setProperty('--book-height', `${Math.round(fitH)}px`);
    } else if (state.isSingleSpread && singleW > stageW) {
      const fitSingleW = stageW * 0.92;
      const fitH = fitSingleW / aspect;
      document.documentElement.style.setProperty('--book-height', `${Math.round(fitH)}px`);
    } else {
      document.documentElement.style.setProperty('--book-height', `${Math.round(targetH)}px`);
    }
  }

  /* --------------------------------------------------------------------------
     Page Spread Helpers
     -------------------------------------------------------------------------- */
  // Returns [leftPageNum, rightPageNum] for the current view
  function getVisiblePageNumbers(page) {
    if (state.isSingleSpread) {
      return [null, page];
    }
    if (page === 1) {
      // Cover page: left is blank, right is Page 1
      return [null, 1];
    }
    if (page === state.totalPages && state.totalPages > 1) {
      // End / Back cover page: right is blank, left is the last page
      return [page, null];
    }
    if (page % 2 === 1) {
      // If odd page > 1, the spread is (page - 1, page)
      return [page - 1, page];
    }
    // If even page, spread is (page, page + 1)
    const right = page + 1 <= state.totalPages ? page + 1 : null;
    return [page, right];
  }

  function getNextPageTarget() {
    if (state.isSingleSpread) {
      return state.currentPage + 1 <= state.totalPages ? state.currentPage + 1 : null;
    }
    if (state.currentPage === 1) {
      return 2; // Goes to spread [2, 3]
    }
    const [left] = getVisiblePageNumbers(state.currentPage);
    const next = (left || state.currentPage) + 2;
    return next <= state.totalPages ? next : null;
  }

  function getPrevPageTarget() {
    if (state.isSingleSpread) {
      return state.currentPage - 1 >= 1 ? state.currentPage - 1 : null;
    }
    if (state.currentPage <= 1) return null;
    if (state.currentPage <= 3) return 1; // Return to cover
    const [left] = getVisiblePageNumbers(state.currentPage);
    const prev = (left || state.currentPage) - 2;
    return prev >= 1 ? prev : 1;
  }

  /* --------------------------------------------------------------------------
     Rendering Engine (with High-DPI Canvas Cache)
     -------------------------------------------------------------------------- */
  async function renderPageToCanvas(pageNum, canvas) {
    if (!state.pdfDoc || pageNum < 1 || pageNum > state.totalPages) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    try {
      const page = await state.pdfDoc.getPage(pageNum);
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5); // Sharp vector rendering
      
      const unscaledViewport = page.getViewport({ scale: 1 });
      // Calculate scale to match element dimensions
      const rect = canvas.getBoundingClientRect();
      const targetHeight = rect.height > 0 ? rect.height : parseInt(getComputedStyle(document.documentElement).getPropertyValue('--book-height')) || 700;
      const scale = (targetHeight / unscaledViewport.height) * dpr;
      
      const viewport = page.getViewport({ scale: scale });

      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);

      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvasContext: ctx,
        viewport: viewport
      }).promise;

    } catch (e) {
      console.error(`Error rendering page ${pageNum}:`, e);
    }
  }

  // Render the current active spread onto stage canvases
  async function renderCurrentSpread() {
    const isCover = (state.currentPage === 1) && !state.isSingleSpread;
    const isEnd = (state.currentPage === state.totalPages && state.totalPages > 1) && !state.isSingleSpread;

    if (isCover) {
      els.book.classList.add('is-cover');
      els.book.classList.remove('is-end');
      els.bookViewport.classList.add('is-cover');
      els.bookViewport.classList.remove('is-end');
      els.book.style.transform = 'translateX(-25%)';
    } else if (isEnd) {
      els.book.classList.add('is-end');
      els.book.classList.remove('is-cover');
      els.bookViewport.classList.add('is-end');
      els.bookViewport.classList.remove('is-cover');
      els.book.style.transform = 'translateX(25%)';
    } else {
      els.book.classList.remove('is-cover', 'is-end');
      els.bookViewport.classList.remove('is-cover', 'is-end');
      els.book.style.transform = 'translateX(0%)';
    }

    const [leftNum, rightNum] = getVisiblePageNumbers(state.currentPage);

    // Left Page
    if (leftNum && !isCover) {
      els.pageLeftWrapper.style.visibility = 'visible';
      els.numLeft.textContent = `Page ${leftNum}`;
      els.numLeft.style.display = isEnd ? 'none' : 'block';
      await renderPageToCanvas(leftNum, els.canvasLeft);
    } else {
      els.pageLeftWrapper.style.visibility = 'hidden';
      els.numLeft.style.display = 'none';
      const ctx = els.canvasLeft.getContext('2d');
      ctx.clearRect(0, 0, els.canvasLeft.width, els.canvasLeft.height);
    }

    // Right Page
    if (rightNum && !isEnd) {
      els.pageRightWrapper.style.visibility = 'visible';
      els.numRight.textContent = `Page ${rightNum}`;
      els.numRight.style.display = isCover ? 'none' : 'block';
      await renderPageToCanvas(rightNum, els.canvasRight);
    } else {
      els.pageRightWrapper.style.visibility = 'hidden';
      els.numRight.style.display = 'none';
      const ctx = els.canvasRight.getContext('2d');
      ctx.clearRect(0, 0, els.canvasRight.width, els.canvasRight.height);
    }

    // Update UI counters and stack thickness
    updateNavigationUI();
    updatePageStacks();
    highlightActiveThumbnail();
  }

  function updateNavigationUI() {
    const [leftNum, rightNum] = getVisiblePageNumbers(state.currentPage);
    const displayPage = (state.currentPage === state.totalPages) ? state.totalPages : (rightNum || leftNum || state.currentPage);
    els.pageInput.value = displayPage;

    // Arrow button states
    const hasPrev = getPrevPageTarget() !== null;
    const hasNext = getNextPageTarget() !== null;

    els.btnPrev.classList.toggle('disabled', !hasPrev);
    els.btnNext.classList.toggle('disabled', !hasNext);
    els.btnFirst.classList.toggle('disabled', state.currentPage <= 1);
    els.btnLast.classList.toggle('disabled', state.currentPage >= state.totalPages);
  }

  // Realistic book stack thickness dynamic adjustment
  function updatePageStacks() {
    if (state.isSingleSpread) {
      els.stackLeft.style.display = 'none';
      els.stackRight.style.display = 'none';
      return;
    }

    if (state.currentPage === 1) {
      // Home / Cover page: left stack hidden, right stack shows full book block (matches uploaded image)
      els.stackLeft.style.display = 'none';
      els.stackRight.style.display = 'block';
      els.stackRight.style.width = '14px';
      els.stackRight.style.right = '-14px';
      return;
    }

    if (state.currentPage === state.totalPages && state.totalPages > 1) {
      // End / Back cover page: right stack hidden, left stack shows full book block
      els.stackRight.style.display = 'none';
      els.stackLeft.style.display = 'block';
      els.stackLeft.style.width = '14px';
      els.stackLeft.style.left = '-14px';
      return;
    }

    els.stackLeft.style.display = 'block';
    els.stackRight.style.display = 'block';

    const progress = state.currentPage / state.totalPages;
    const maxThickness = 14;
    const leftWidth = Math.max(2, Math.round(progress * maxThickness));
    const rightWidth = Math.max(2, Math.round((1 - progress) * maxThickness));

    els.stackLeft.style.width = `${leftWidth}px`;
    els.stackLeft.style.left = `-${leftWidth}px`;
    els.stackRight.style.width = `${rightWidth}px`;
    els.stackRight.style.right = `-${rightWidth}px`;
  }

  /* --------------------------------------------------------------------------
     3D Page Flip Animation Controller - Realistic Cylindrical Page Curl
     -------------------------------------------------------------------------- */
  async function flipToNext() {
    if (state.isFlipping) return;
    const targetPage = getNextPageTarget();
    if (!targetPage) return;

    state.isFlipping = true;
    playPaperTurnSound();

    const [curLeft, curRight] = getVisiblePageNumbers(state.currentPage);
    const [nextLeft, nextRight] = getVisiblePageNumbers(targetPage);

    const isStartingFromCover = (state.currentPage === 1) && !state.isSingleSpread;
    const isLandingOnEnd = (targetPage === state.totalPages && state.totalPages > 1) && !state.isSingleSpread;

    // Setup Leaf
    // Leaf Front = current right page (the one peeling away)
    // Leaf Back = next left page (the backside landing on the left)
    const leafFrontPage = curRight || curLeft;
    const leafBackPage = nextLeft;

    await Promise.all([
      renderPageToCanvas(leafFrontPage, els.canvasLeafFront),
      renderPageToCanvas(leafBackPage, els.canvasLeafBack),
      // Underneath right side should now render the target next right page
      renderPageToCanvas(nextRight, els.canvasRight)
    ]);

    // Position leaf
    els.flipLeaf.className = 'flip-leaf flip-forward';
    els.flipLeaf.style.display = 'block';
    if (els.flipCastShadow) {
      els.flipCastShadow.style.display = 'block';
    }

    els.book.style.transition = 'none';

    const duration = 540; // ms for natural, responsive page turning
    const startTime = performance.now();

    function animateFlip(now) {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      // Smooth harmonic sinusoidal page turning easing curve
      const ease = 0.5 - 0.5 * Math.cos(t * Math.PI);
      const angle = -180 * ease;

      els.flipLeaf.style.transform = `rotateY(${angle}deg)`;

      if (isStartingFromCover) {
        // Glide from -25% (cover centered) to 0% (spread centered)
        const shift = -25 * (1 - ease);
        els.book.style.transform = `translateX(${shift}%)`;
      } else if (isLandingOnEnd) {
        // Glide from 0% (spread centered) to +25% (end page centered)
        const shift = 25 * ease;
        els.book.style.transform = `translateX(${shift}%)`;
      }

      // Dynamic lighting across the turning page surface
      const arch = Math.sin(ease * Math.PI);
      if (ease <= 0.5) {
        els.shadowFront.style.opacity = (arch * 0.42).toFixed(3);
        els.shadowFront.style.background = `linear-gradient(to right, 
          rgba(0, 0, 0, 0.12) 0%, 
          rgba(255, 255, 255, 0.38) ${Math.round(25 + ease * 45)}%, 
          rgba(0, 0, 0, 0.16) 100%)`;
        els.shadowBack.style.opacity = '0';

        if (els.flipCastShadow) {
          els.flipCastShadow.style.left = '50%';
          els.flipCastShadow.style.width = '50%';
          els.flipCastShadow.style.opacity = (arch * 0.35).toFixed(3);
          els.flipCastShadow.style.background = `linear-gradient(to right, rgba(0, 0, 0, 0.22) 0%, transparent 75%)`;
        }
      } else {
        els.shadowBack.style.opacity = (arch * 0.42).toFixed(3);
        els.shadowBack.style.background = `linear-gradient(to left, 
          rgba(0, 0, 0, 0.12) 0%, 
          rgba(255, 255, 255, 0.38) ${Math.round(25 + (1 - ease) * 45)}%, 
          rgba(0, 0, 0, 0.16) 100%)`;
        els.shadowFront.style.opacity = '0';

        if (els.flipCastShadow) {
          els.flipCastShadow.style.left = '0';
          els.flipCastShadow.style.width = '50%';
          els.flipCastShadow.style.opacity = (arch * 0.35).toFixed(3);
          els.flipCastShadow.style.background = `linear-gradient(to left, rgba(0, 0, 0, 0.22) 0%, transparent 75%)`;
        }
      }

      if (t < 1) {
        requestAnimationFrame(animateFlip);
      } else {
        // Complete flip
        state.currentPage = targetPage;
        els.flipLeaf.style.display = 'none';
        els.flipLeaf.style.transform = 'none';
        if (els.flipCastShadow) els.flipCastShadow.style.display = 'none';
        renderCurrentSpread();
        state.isFlipping = false;
      }
    }

    requestAnimationFrame(animateFlip);
  }

  async function flipToPrev() {
    if (state.isFlipping) return;
    const targetPage = getPrevPageTarget();
    if (targetPage === null) return;

    state.isFlipping = true;
    playPaperTurnSound();

    const [curLeft, curRight] = getVisiblePageNumbers(state.currentPage);
    const [prevLeft, prevRight] = getVisiblePageNumbers(targetPage);

    const isLandingOnCover = (targetPage === 1) && !state.isSingleSpread;
    const isStartingFromEnd = (state.currentPage === state.totalPages && state.totalPages > 1) && !state.isSingleSpread;

    // Setup Leaf for backward flip
    // Leaf Back = current left page (lifting up from left)
    // Leaf Front = target prev right page (landing onto right)
    const leafBackPage = curLeft || curRight;
    const leafFrontPage = prevRight;

    await Promise.all([
      renderPageToCanvas(leafFrontPage, els.canvasLeafFront),
      renderPageToCanvas(leafBackPage, els.canvasLeafBack),
      // Underneath left side should now render the target prev left page
      renderPageToCanvas(prevLeft, els.canvasLeft)
    ]);

    els.flipLeaf.className = 'flip-leaf flip-backward';
    els.flipLeaf.style.display = 'block';
    if (els.flipCastShadow) {
      els.flipCastShadow.style.display = 'block';
    }

    els.book.style.transition = 'none';

    const duration = 540;
    const startTime = performance.now();

    function animateFlip(now) {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      const ease = 0.5 - 0.5 * Math.cos(t * Math.PI);
      const angle = -180 + (180 * ease);

      els.flipLeaf.style.transform = `rotateY(${angle}deg)`;

      if (isLandingOnCover) {
        // Glide from 0% (spread centered) to -25% (cover centered)
        const shift = -25 * ease;
        els.book.style.transform = `translateX(${shift}%)`;
      } else if (isStartingFromEnd) {
        // Glide from +25% (end page centered) to 0% (spread centered)
        const shift = 25 * (1 - ease);
        els.book.style.transform = `translateX(${shift}%)`;
      }

      const arch = Math.sin(ease * Math.PI);
      if (ease <= 0.5) {
        els.shadowBack.style.opacity = (arch * 0.42).toFixed(3);
        els.shadowBack.style.background = `linear-gradient(to left, 
          rgba(0, 0, 0, 0.12) 0%, 
          rgba(255, 255, 255, 0.38) ${Math.round(25 + ease * 45)}%, 
          rgba(0, 0, 0, 0.16) 100%)`;
        els.shadowFront.style.opacity = '0';

        if (els.flipCastShadow) {
          els.flipCastShadow.style.left = '0';
          els.flipCastShadow.style.width = '50%';
          els.flipCastShadow.style.opacity = (arch * 0.35).toFixed(3);
          els.flipCastShadow.style.background = `linear-gradient(to left, rgba(0, 0, 0, 0.22) 0%, transparent 75%)`;
        }
      } else {
        els.shadowFront.style.opacity = (arch * 0.42).toFixed(3);
        els.shadowFront.style.background = `linear-gradient(to right, 
          rgba(0, 0, 0, 0.12) 0%, 
          rgba(255, 255, 255, 0.38) ${Math.round(25 + (1 - ease) * 45)}%, 
          rgba(0, 0, 0, 0.16) 100%)`;
        els.shadowBack.style.opacity = '0';

        if (els.flipCastShadow) {
          els.flipCastShadow.style.left = '50%';
          els.flipCastShadow.style.width = '50%';
          els.flipCastShadow.style.opacity = (arch * 0.35).toFixed(3);
          els.flipCastShadow.style.background = `linear-gradient(to right, rgba(0, 0, 0, 0.22) 0%, transparent 75%)`;
        }
      }

      if (t < 1) {
        requestAnimationFrame(animateFlip);
      } else {
        state.currentPage = targetPage;
        els.flipLeaf.style.display = 'none';
        els.flipLeaf.style.transform = 'none';
        if (els.flipCastShadow) els.flipCastShadow.style.display = 'none';
        renderCurrentSpread();
        state.isFlipping = false;
      }
    }

    requestAnimationFrame(animateFlip);
  }

  function goToPage(target) {
    target = Math.max(1, Math.min(state.totalPages, parseInt(target) || 1));
    if (target === state.currentPage) return;

    if (target > state.currentPage) {
      // If jumping ahead by 1 step, animate smoothly
      if (getNextPageTarget() === target) {
        flipToNext();
      } else {
        state.currentPage = target;
        playPaperTurnSound();
        renderCurrentSpread();
      }
    } else {
      if (getPrevPageTarget() === target) {
        flipToPrev();
      } else {
        state.currentPage = target;
        playPaperTurnSound();
        renderCurrentSpread();
      }
    }
  }

  /* --------------------------------------------------------------------------
     Mouse Drag & Touch Swipe Page Turn Interactions
     -------------------------------------------------------------------------- */
  function setupDragAndSwipe() {
    let startX = 0;
    let startY = 0;
    let isDragging = false;
    let dragDirection = null; // 'next' or 'prev'
    let bookWidth = 0;

    function handleStart(clientX, clientY, source) {
      if (state.isFlipping || state.zoomLevel > 1) return;
      startX = clientX;
      startY = clientY;
      isDragging = true;
      bookWidth = els.book.getBoundingClientRect().width / (state.isSingleSpread ? 1 : 2);
    }

    function handleMove(clientX, clientY) {
      if (!isDragging) return;
      const deltaX = clientX - startX;
      const deltaY = clientY - startY;

      // Ignore vertical swipes
      if (Math.abs(deltaY) > Math.abs(deltaX) * 1.5 && !dragDirection) {
        return;
      }

      if (!dragDirection) {
        if (deltaX < -15 && getNextPageTarget() !== null) {
          dragDirection = 'next';
          setupInteractiveLeaf('next');
        } else if (deltaX > 15 && getPrevPageTarget() !== null) {
          dragDirection = 'prev';
          setupInteractiveLeaf('prev');
        }
      }

      if (dragDirection === 'next') {
        const progress = Math.max(0, Math.min(1, -deltaX / bookWidth));
        const angle = -180 * progress;
        els.flipLeaf.style.transform = `rotateY(${angle}deg)`;
        if (state.currentPage === 1 && !state.isSingleSpread) {
          const shift = -25 * (1 - progress);
          els.book.style.transform = `translateX(${shift}%)`;
        } else if (getNextPageTarget() === state.totalPages && !state.isSingleSpread) {
          const shift = 25 * progress;
          els.book.style.transform = `translateX(${shift}%)`;
        }
        updateInteractiveShadows(progress, 'next');
      } else if (dragDirection === 'prev') {
        const progress = Math.max(0, Math.min(1, deltaX / bookWidth));
        const angle = -180 + (180 * progress);
        els.flipLeaf.style.transform = `rotateY(${angle}deg)`;
        const targetPage = getPrevPageTarget();
        if (targetPage === 1 && !state.isSingleSpread) {
          const shift = -25 * progress;
          els.book.style.transform = `translateX(${shift}%)`;
        } else if (state.currentPage === state.totalPages && !state.isSingleSpread) {
          const shift = 25 * (1 - progress);
          els.book.style.transform = `translateX(${shift}%)`;
        }
        updateInteractiveShadows(progress, 'prev');
      }
    }

    function handleEnd(clientX) {
      if (!isDragging) return;
      isDragging = false;

      if (!dragDirection) return;

      const deltaX = clientX - startX;
      const progress = Math.abs(deltaX) / bookWidth;

      if (progress > 0.25) {
        // Complete the flip
        if (dragDirection === 'next') {
          completeDragFlip('next');
        } else {
          completeDragFlip('prev');
        }
      } else {
        // Cancel and snap back
        cancelDragFlip(dragDirection);
      }

      dragDirection = null;
    }

    async function setupInteractiveLeaf(dir) {
      els.flipLeaf.style.transition = 'none';
      if (els.flipCastShadow) {
        els.flipCastShadow.style.display = 'block';
      }
      if (dir === 'next') {
        const targetPage = getNextPageTarget();
        const [curLeft, curRight] = getVisiblePageNumbers(state.currentPage);
        const [nextLeft, nextRight] = getVisiblePageNumbers(targetPage);
        renderPageToCanvas(curRight || curLeft, els.canvasLeafFront);
        renderPageToCanvas(nextLeft, els.canvasLeafBack);
        renderPageToCanvas(nextRight, els.canvasRight);
        els.flipLeaf.className = 'flip-leaf flip-forward';
        els.flipLeaf.style.display = 'block';
        els.flipLeaf.style.transform = 'rotateY(0deg)';
      } else {
        const targetPage = getPrevPageTarget();
        const [curLeft, curRight] = getVisiblePageNumbers(state.currentPage);
        const [prevLeft, prevRight] = getVisiblePageNumbers(targetPage);
        renderPageToCanvas(prevRight, els.canvasLeafFront);
        renderPageToCanvas(curLeft || curRight, els.canvasLeafBack);
        renderPageToCanvas(prevLeft, els.canvasLeft);
        els.flipLeaf.className = 'flip-leaf flip-backward';
        els.flipLeaf.style.display = 'block';
        els.flipLeaf.style.transform = 'rotateY(-180deg)';
      }
    }

    function updateInteractiveShadows(progress, dir = 'next') {
      const arch = Math.sin(progress * Math.PI);
      if (dir === 'next') {
        if (progress <= 0.5) {
          els.shadowFront.style.opacity = (arch * 0.42).toFixed(3);
          els.shadowFront.style.background = `linear-gradient(to right, 
            rgba(0, 0, 0, 0.12) 0%, 
            rgba(255, 255, 255, 0.38) ${Math.round(25 + progress * 45)}%, 
            rgba(0, 0, 0, 0.16) 100%)`;
          els.shadowBack.style.opacity = '0';
          if (els.flipCastShadow) {
            els.flipCastShadow.style.left = '50%';
            els.flipCastShadow.style.width = '50%';
            els.flipCastShadow.style.opacity = (arch * 0.35).toFixed(3);
            els.flipCastShadow.style.background = `linear-gradient(to right, rgba(0, 0, 0, 0.22) 0%, transparent 75%)`;
          }
        } else {
          els.shadowBack.style.opacity = (arch * 0.42).toFixed(3);
          els.shadowBack.style.background = `linear-gradient(to left, 
            rgba(0, 0, 0, 0.12) 0%, 
            rgba(255, 255, 255, 0.38) ${Math.round(25 + (1 - progress) * 45)}%, 
            rgba(0, 0, 0, 0.16) 100%)`;
          els.shadowFront.style.opacity = '0';
          if (els.flipCastShadow) {
            els.flipCastShadow.style.left = '0';
            els.flipCastShadow.style.width = '50%';
            els.flipCastShadow.style.opacity = (arch * 0.35).toFixed(3);
            els.flipCastShadow.style.background = `linear-gradient(to left, rgba(0, 0, 0, 0.22) 0%, transparent 75%)`;
          }
        }
      } else {
        if (progress <= 0.5) {
          els.shadowBack.style.opacity = (arch * 0.42).toFixed(3);
          els.shadowBack.style.background = `linear-gradient(to left, 
            rgba(0, 0, 0, 0.12) 0%, 
            rgba(255, 255, 255, 0.38) ${Math.round(25 + progress * 45)}%, 
            rgba(0, 0, 0, 0.16) 100%)`;
          els.shadowFront.style.opacity = '0';
          if (els.flipCastShadow) {
            els.flipCastShadow.style.left = '0';
            els.flipCastShadow.style.width = '50%';
            els.flipCastShadow.style.opacity = (arch * 0.35).toFixed(3);
            els.flipCastShadow.style.background = `linear-gradient(to left, rgba(0, 0, 0, 0.22) 0%, transparent 75%)`;
          }
        } else {
          els.shadowFront.style.opacity = (arch * 0.42).toFixed(3);
          els.shadowFront.style.background = `linear-gradient(to right, 
            rgba(0, 0, 0, 0.12) 0%, 
            rgba(255, 255, 255, 0.38) ${Math.round(25 + (1 - progress) * 45)}%, 
            rgba(0, 0, 0, 0.16) 100%)`;
          els.shadowBack.style.opacity = '0';
          if (els.flipCastShadow) {
            els.flipCastShadow.style.left = '50%';
            els.flipCastShadow.style.width = '50%';
            els.flipCastShadow.style.opacity = (arch * 0.35).toFixed(3);
            els.flipCastShadow.style.background = `linear-gradient(to right, rgba(0, 0, 0, 0.22) 0%, transparent 75%)`;
          }
        }
      }
    }

    function completeDragFlip(dir) {
      els.flipLeaf.style.transition = 'transform 0.32s cubic-bezier(0.16, 1, 0.3, 1)';
      playPaperTurnSound();
      if (dir === 'next') {
        els.flipLeaf.style.transform = 'rotateY(-180deg)';
        const targetPage = getNextPageTarget();
        if (state.currentPage === 1 && !state.isSingleSpread) {
          els.book.style.transition = 'transform 0.32s cubic-bezier(0.16, 1, 0.3, 1)';
          els.book.style.transform = 'translateX(0%)';
        } else if (targetPage === state.totalPages && !state.isSingleSpread) {
          els.book.style.transition = 'transform 0.32s cubic-bezier(0.16, 1, 0.3, 1)';
          els.book.style.transform = 'translateX(25%)';
        }
        setTimeout(() => {
          state.currentPage = targetPage;
          els.flipLeaf.style.display = 'none';
          els.flipLeaf.style.transform = 'none';
          if (els.flipCastShadow) els.flipCastShadow.style.display = 'none';
          els.book.style.transition = '';
          renderCurrentSpread();
        }, 340);
      } else {
        els.flipLeaf.style.transform = 'rotateY(0deg)';
        const targetPage = getPrevPageTarget();
        if (targetPage === 1 && !state.isSingleSpread) {
          els.book.style.transition = 'transform 0.32s cubic-bezier(0.16, 1, 0.3, 1)';
          els.book.style.transform = 'translateX(-25%)';
        } else if (state.currentPage === state.totalPages && !state.isSingleSpread) {
          els.book.style.transition = 'transform 0.32s cubic-bezier(0.16, 1, 0.3, 1)';
          els.book.style.transform = 'translateX(0%)';
        }
        setTimeout(() => {
          state.currentPage = targetPage;
          els.flipLeaf.style.display = 'none';
          els.flipLeaf.style.transform = 'none';
          if (els.flipCastShadow) els.flipCastShadow.style.display = 'none';
          els.book.style.transition = '';
          renderCurrentSpread();
        }, 340);
      }
    }

    function cancelDragFlip(dir) {
      els.flipLeaf.style.transition = 'transform 0.28s ease-out';
      if (dir === 'next') {
        els.flipLeaf.style.transform = 'rotateY(0deg)';
        if (state.currentPage === 1 && !state.isSingleSpread) {
          els.book.style.transition = 'transform 0.28s ease-out';
          els.book.style.transform = 'translateX(-25%)';
        } else if (getNextPageTarget() === state.totalPages && !state.isSingleSpread) {
          els.book.style.transition = 'transform 0.28s ease-out';
          els.book.style.transform = 'translateX(0%)';
        }
      } else {
        els.flipLeaf.style.transform = 'rotateY(-180deg)';
        if (state.currentPage === state.totalPages && !state.isSingleSpread) {
          els.book.style.transition = 'transform 0.28s ease-out';
          els.book.style.transform = 'translateX(25%)';
        } else if (state.currentPage !== 1 && !state.isSingleSpread) {
          els.book.style.transition = 'transform 0.28s ease-out';
          els.book.style.transform = 'translateX(0%)';
        }
      }
      setTimeout(() => {
        els.flipLeaf.style.display = 'none';
        els.flipLeaf.style.transform = 'none';
        if (els.flipCastShadow) els.flipCastShadow.style.display = 'none';
        els.book.style.transition = '';
        renderCurrentSpread();
      }, 290);
    }

    // Hotspot Drag Listeners
    els.dragZoneRight.addEventListener('mousedown', (e) => handleStart(e.clientX, e.clientY, 'right'));
    els.dragZoneLeft.addEventListener('mousedown', (e) => handleStart(e.clientX, e.clientY, 'left'));

    // Global drag tracking
    window.addEventListener('mousemove', (e) => handleMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', (e) => handleEnd(e.clientX));

    // Touch events for mobile/tablet swipe
    els.stage.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        handleStart(e.touches[0].clientX, e.touches[0].clientY, 'touch');
      }
    }, { passive: true });

    els.stage.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1) {
        handleMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });

    els.stage.addEventListener('touchend', (e) => {
      if (e.changedTouches.length === 1) {
        handleEnd(e.changedTouches[0].clientX);
      }
    });
  }

  /* --------------------------------------------------------------------------
     Zoom & Pan System
     -------------------------------------------------------------------------- */
  function applyZoom(newLevel) {
    state.zoomLevel = Math.max(1.0, Math.min(3.0, Math.round(newLevel * 10) / 10));
    els.zoomPercent.textContent = `${Math.round(state.zoomLevel * 100)}%`;

    if (state.zoomLevel === 1.0) {
      state.panX = 0;
      state.panY = 0;
      els.bookViewport.style.transform = 'translate(0px, 0px) scale(1)';
      els.zoomFloatHint.classList.add('hidden');
    } else {
      els.bookViewport.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoomLevel})`;
      els.zoomFloatHint.classList.remove('hidden');
    }
  }

  function setupZoomAndPan() {
    els.btnZoomIn.addEventListener('click', () => applyZoom(state.zoomLevel + 0.25));
    els.btnZoomOut.addEventListener('click', () => applyZoom(state.zoomLevel - 0.25));
    els.btnZoomVal.addEventListener('click', () => applyZoom(1.0));
    els.btnZoomResetHint.addEventListener('click', () => applyZoom(1.0));

    // Mouse wheel zoom with Ctrl key
    window.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.15 : -0.15;
        applyZoom(state.zoomLevel + delta);
      }
    }, { passive: false });

    // Pan viewport when zoomed in
    els.bookViewport.addEventListener('mousedown', (e) => {
      if (state.zoomLevel <= 1.0) return;
      state.isPanning = true;
      state.panStartX = e.clientX - state.panX;
      state.panStartY = e.clientY - state.panY;
      els.bookViewport.classList.add('panning');
    });

    window.addEventListener('mousemove', (e) => {
      if (!state.isPanning) return;
      state.panX = e.clientX - state.panStartX;
      state.panY = e.clientY - state.panStartY;
      els.bookViewport.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoomLevel})`;
    });

    window.addEventListener('mouseup', () => {
      if (state.isPanning) {
        state.isPanning = false;
        els.bookViewport.classList.remove('panning');
      }
    });
  }

  /* --------------------------------------------------------------------------
     Thumbnails Drawer Engine
     -------------------------------------------------------------------------- */
  async function buildThumbnailsDrawer() {
    if (!state.pdfDoc) return;
    els.thumbsContainer.innerHTML = '';

    for (let i = 1; i <= state.totalPages; i++) {
      const card = document.createElement('div');
      card.className = `thumb-card ${i === state.currentPage ? 'active' : ''}`;
      card.dataset.page = i;

      const imgWrapper = document.createElement('div');
      imgWrapper.className = 'thumb-img-wrapper';

      const canvas = document.createElement('canvas');
      imgWrapper.appendChild(canvas);

      const label = document.createElement('span');
      label.className = 'thumb-label';
      label.textContent = `P. ${i}`;

      card.appendChild(imgWrapper);
      card.appendChild(label);

      card.addEventListener('click', () => {
        goToPage(i);
        highlightActiveThumbnail();
      });

      els.thumbsContainer.appendChild(card);

      // Lazy render thumbnail on request
      lazyRenderThumbnail(i, canvas);
    }
  }

  async function lazyRenderThumbnail(pageNum, canvas) {
    try {
      const page = await state.pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 0.18 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await page.render({
        canvasContext: ctx,
        viewport: viewport
      }).promise;
    } catch (e) {
      // ignore cancelled thumbnail renders
    }
  }

  function highlightActiveThumbnail() {
    const cards = els.thumbsContainer.querySelectorAll('.thumb-card');
    cards.forEach((card) => {
      const p = parseInt(card.dataset.page);
      const [left, right] = getVisiblePageNumbers(state.currentPage);
      const isActive = p === left || p === right || p === state.currentPage;
      card.classList.toggle('active', isActive);
      if (isActive && els.thumbsDrawer.classList.contains('open')) {
        card.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    });
  }

  /* --------------------------------------------------------------------------
     PDF Text Search Indexer & UI
     -------------------------------------------------------------------------- */
  async function indexDocumentForSearch() {
    if (!state.pdfDoc) return;
    state.searchIndex = [];

    for (let i = 1; i <= state.totalPages; i++) {
      try {
        const page = await state.pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        const fullText = textContent.items.map(item => item.str).join(' ');
        state.searchIndex.push({
          pageNum: i,
          text: fullText
        });
      } catch (e) {
        // ignore indexing errors
      }
    }
  }

  function executeSearch(query) {
    query = (query || '').trim().toLowerCase();
    state.searchQuery = query;
    els.searchResultsList.innerHTML = '';

    if (!query) {
      els.searchStats.textContent = 'Enter keyword to search across all pages';
      return;
    }

    if (state.searchIndex.length === 0) {
      els.searchStats.textContent = 'Indexing in progress, please retry in a moment...';
      return;
    }

    const matches = [];
    state.searchIndex.forEach(({ pageNum, text }) => {
      const lower = text.toLowerCase();
      const idx = lower.indexOf(query);
      if (idx !== -1) {
        // Extract preview snippet with mark highlight
        const start = Math.max(0, idx - 45);
        const end = Math.min(text.length, idx + query.length + 55);
        const snippet = text.substring(start, end);
        const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        const highlighted = snippet.replace(regex, '<mark>$1</mark>');

        matches.push({
          pageNum,
          snippet: (start > 0 ? '...' : '') + highlighted + (end < text.length ? '...' : '')
        });
      }
    });

    state.searchResults = matches;

    if (matches.length === 0) {
      els.searchStats.textContent = `No matches found for "${query}"`;
      return;
    }

    els.searchStats.textContent = `Found ${matches.length} page match${matches.length > 1 ? 'es' : ''} for "${query}"`;

    matches.forEach(item => {
      const card = document.createElement('div');
      card.className = 'search-result-card';
      card.innerHTML = `
        <div class="search-res-header">
          <span class="search-res-page">Page ${item.pageNum}</span>
        </div>
        <div class="search-res-snippet">${item.snippet}</div>
      `;
      card.addEventListener('click', () => {
        goToPage(item.pageNum);
        // Highlight active thumbnail and keep search panel accessible
      });
      els.searchResultsList.appendChild(card);
    });
  }

  /* --------------------------------------------------------------------------
     Table of Contents / Outline Builder
     -------------------------------------------------------------------------- */
  async function buildTableOfContents() {
    if (!state.pdfDoc) return;
    els.outlineList.innerHTML = '';

    try {
      const outline = await state.pdfDoc.getOutline();
      if (outline && outline.length > 0) {
        for (const item of outline) {
          const div = document.createElement('div');
          div.className = 'outline-item';
          div.textContent = item.title;
          div.addEventListener('click', async () => {
            if (item.dest) {
              const dest = typeof item.dest === 'string' ? await state.pdfDoc.getDestination(item.dest) : item.dest;
              if (dest) {
                const pageIndex = await state.pdfDoc.getPageIndex(dest[0]);
                goToPage(pageIndex + 1);
                els.outlinePanel.classList.remove('open');
                els.btnToggleOutline?.classList.remove('active');
              }
            }
          });
          els.outlineList.appendChild(div);
        }
      } else {
        // Fallback standard annual report sections
        const standardSections = [
          { title: 'Cover & Overview', page: 1 },
          { title: 'Corporate Information', page: 2 },
          { title: 'Financial & Operational Highlights', page: 4 },
          { title: 'Chairman & MD Statements', page: 6 },
          { title: 'Management Discussion & Analysis', page: 10 },
          { title: 'Governance & Risk Management', page: 24 },
          { title: 'Financial Statements & Audit Report', page: 40 },
          { title: 'Notes to the Financial Statements', page: 52 }
        ];

        standardSections.forEach(sec => {
          if (sec.page <= state.totalPages) {
            const div = document.createElement('div');
            div.className = 'outline-item';
            div.innerHTML = `<strong>${sec.title}</strong> <span style="float:right;color:var(--accent-gold);font-size:0.75rem;">P. ${sec.page}</span>`;
            div.addEventListener('click', () => {
              goToPage(sec.page);
              els.outlinePanel.classList.remove('open');
              els.btnToggleOutline?.classList.remove('active');
            });
            els.outlineList.appendChild(div);
          }
        });
      }
    } catch (e) {
      console.warn('Error reading outline:', e);
    }
  }

  /* --------------------------------------------------------------------------
     Event Listeners & Toolbar Handlers
     -------------------------------------------------------------------------- */
  function setupEventListeners() {
    // Cover and End page fullscreen badge handlers (matching uploaded screenshot)
    els.coverFullscreenBadge = document.getElementById('cover-fullscreen-badge');
    if (els.coverFullscreenBadge) {
      els.coverFullscreenBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        els.btnFullscreen.click();
      });
    }

    els.endFullscreenBadge = document.getElementById('end-fullscreen-badge');
    if (els.endFullscreenBadge) {
      els.endFullscreenBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        els.btnFullscreen.click();
      });
    }

    // Direct page click-to-turn handlers
    els.pageRightWrapper?.addEventListener('click', (e) => {
      if (e.target.closest('#cover-fullscreen-badge')) return;
      if (state.isFlipping || state.zoomLevel > 1) return;
      flipToNext();
    });

    els.pageLeftWrapper?.addEventListener('click', (e) => {
      if (e.target.closest('#end-fullscreen-badge')) return;
      if (state.isFlipping || state.zoomLevel > 1) return;
      flipToPrev();
    });

    // Navigation buttons
    els.btnNext.addEventListener('click', flipToNext);
    els.btnPrev.addEventListener('click', flipToPrev);
    els.btnFirst.addEventListener('click', () => goToPage(1));
    els.btnLast.addEventListener('click', () => goToPage(state.totalPages));

    // Page input direct jump
    els.pageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        goToPage(parseInt(els.pageInput.value));
        els.pageInput.blur();
      }
    });

    els.pageInput.addEventListener('blur', () => {
      updateNavigationUI();
    });

    // Spread mode toggle (if present)
    if (els.btnToggleSpread) {
      els.btnToggleSpread.addEventListener('click', () => {
        state.userForcedSingle = !state.userForcedSingle;
        checkResponsiveLayout();
        renderCurrentSpread();
      });
    }

    // Sound toggle
    els.btnSound.addEventListener('click', () => {
      state.soundEnabled = !state.soundEnabled;
      els.soundIconOn.classList.toggle('hidden', !state.soundEnabled);
      els.soundIconOff.classList.toggle('hidden', state.soundEnabled);
    });

    // Fullscreen toggle
    els.btnFullscreen.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
        els.fsIconEnter.classList.add('hidden');
        els.fsIconExit.classList.remove('hidden');
      } else {
        document.exitFullscreen().catch(() => {});
        els.fsIconEnter.classList.remove('hidden');
        els.fsIconExit.classList.add('hidden');
      }
    });

    document.addEventListener('fullscreenchange', () => {
      const isFS = !!document.fullscreenElement;
      els.fsIconEnter.classList.toggle('hidden', isFS);
      els.fsIconExit.classList.toggle('hidden', !isFS);
    });

    // Search Flyout
    els.btnToggleSearch?.addEventListener('click', () => {
      const isOpen = els.searchPanel.classList.toggle('open');
      els.btnToggleSearch?.classList.toggle('active', isOpen);
      if (isOpen) {
        els.outlinePanel.classList.remove('open');
        els.btnToggleOutline?.classList.remove('active');
        els.searchQueryInput.focus();
      }
    });

    els.btnCloseSearch?.addEventListener('click', () => {
      els.searchPanel.classList.remove('open');
      els.btnToggleSearch?.classList.remove('active');
    });

    els.searchQueryInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        executeSearch(els.searchQueryInput.value);
      }
    });

    els.btnSearchExec?.addEventListener('click', () => {
      executeSearch(els.searchQueryInput.value);
    });

    // Table of Contents Flyout
    els.btnToggleOutline?.addEventListener('click', () => {
      const isOpen = els.outlinePanel.classList.toggle('open');
      els.btnToggleOutline?.classList.toggle('active', isOpen);
      if (isOpen) {
        els.searchPanel.classList.remove('open');
        els.btnToggleSearch?.classList.remove('active');
      }
    });

    els.btnCloseOutline?.addEventListener('click', () => {
      els.outlinePanel.classList.remove('open');
      els.btnToggleOutline?.classList.remove('active');
    });

    // Thumbnails Drawer
    els.btnToggleThumbs?.addEventListener('click', () => {
      const isOpen = els.thumbsDrawer.classList.toggle('open');
      els.btnToggleThumbs?.classList.toggle('active', isOpen);
      if (isOpen) {
        highlightActiveThumbnail();
      }
    });

    els.btnCloseThumbs?.addEventListener('click', () => {
      els.thumbsDrawer.classList.remove('open');
      els.btnToggleThumbs?.classList.remove('active');
    });

    // Autoplay / Slideshow
    els.btnAutoplay?.addEventListener('click', toggleAutoplay);

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (['input', 'textarea'].includes(document.activeElement.tagName.toLowerCase())) {
        return;
      }

      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        flipToNext();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        flipToPrev();
      } else if (e.key === 'Home') {
        e.preventDefault();
        goToPage(1);
      } else if (e.key === 'End') {
        e.preventDefault();
        goToPage(state.totalPages);
      } else if (e.key === 'f' || e.key === 'F') {
        els.btnFullscreen.click();
      } else if (e.key === ' ') {
        e.preventDefault();
        toggleAutoplay();
      } else if (e.key === 'Escape') {
        els.searchPanel.classList.remove('open');
        els.btnToggleSearch?.classList.remove('active');
        els.outlinePanel.classList.remove('open');
        els.btnToggleOutline?.classList.remove('active');
        els.thumbsDrawer.classList.remove('open');
        els.btnToggleThumbs?.classList.remove('active');
        if (state.zoomLevel > 1) applyZoom(1.0);
      }
    });

    // Window resize
    window.addEventListener('resize', debounce(() => {
      checkResponsiveLayout();
      renderCurrentSpread();
    }, 150));
  }

  function toggleAutoplay() {
    state.autoplayActive = !state.autoplayActive;
    els.playIcon?.classList.toggle('hidden', state.autoplayActive);
    els.pauseIcon?.classList.toggle('hidden', !state.autoplayActive);

    if (state.autoplayActive) {
      state.autoplayTimer = setInterval(() => {
        if (getNextPageTarget() !== null) {
          flipToNext();
        } else {
          goToPage(1); // loop back to cover
        }
      }, 4200);
    } else {
      clearInterval(state.autoplayTimer);
      state.autoplayTimer = null;
    }
  }

  function debounce(func, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  /* --------------------------------------------------------------------------
     Initialization Lifecycle
     -------------------------------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    setupDragAndSwipe();
    setupZoomAndPan();
    initPDF();
  });

})();
