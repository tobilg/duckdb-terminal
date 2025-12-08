/**
 * DuckDB Terminal - User Guide Entry Point
 */

// Theme names available in the application
const themeNames = ['dark', 'light', 'tokyo-night', 'dracula', 'solarized-dark'];

// Get saved theme from localStorage
function getSavedThemeName(): string {
  try {
    const saved = localStorage.getItem('duckdb-terminal-theme');
    if (saved && themeNames.includes(saved)) {
      return saved;
    }
  } catch {
    // localStorage not available
  }
  return 'dark';
}

// Save theme to localStorage
function saveThemeName(name: string): void {
  try {
    localStorage.setItem('duckdb-terminal-theme', name);
  } catch {
    // localStorage not available
  }
}

// Apply theme class to body
function applyTheme(themeName: string): void {
  themeNames.forEach((cls) => document.body.classList.remove(cls));
  document.body.classList.add(themeName);
}

// Initialize theme
function initTheme(): void {
  const savedThemeName = getSavedThemeName();
  applyTheme(savedThemeName);

  // Set dropdown to saved value
  const themeSelect = document.getElementById('theme-select') as HTMLSelectElement;
  if (themeSelect) {
    themeSelect.value = savedThemeName;
    themeSelect.addEventListener('change', () => {
      const themeName = themeSelect.value;
      if (themeNames.includes(themeName)) {
        saveThemeName(themeName);
        applyTheme(themeName);
      }
    });
  }
}

// Set up navigation highlighting based on scroll position
function setupScrollNavigation(): void {
  const navLinks = document.querySelectorAll('.guide-nav-link');
  const sections = document.querySelectorAll('.guide-section');
  const contentWrapper = document.querySelector('.guide-content-wrapper');

  if (!contentWrapper || navLinks.length === 0 || sections.length === 0) {
    return;
  }

  // Update active nav link based on scroll position
  function updateActiveLink(): void {
    const scrollTop = contentWrapper!.scrollTop;
    const offset = 100; // Offset for when to consider a section active

    let currentSection = '';

    sections.forEach((section) => {
      const sectionTop = (section as HTMLElement).offsetTop - offset;
      const sectionId = section.getAttribute('id');

      if (scrollTop >= sectionTop && sectionId) {
        currentSection = sectionId;
      }
    });

    navLinks.forEach((link) => {
      link.classList.remove('active');
      const href = link.getAttribute('href');
      if (href === `#${currentSection}`) {
        link.classList.add('active');
      }
    });
  }

  contentWrapper.addEventListener('scroll', updateActiveLink);

  // Smooth scroll to section when clicking nav links
  navLinks.forEach((link) => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      if (href?.startsWith('#')) {
        e.preventDefault();
        const targetId = href.slice(1);
        const targetElement = document.getElementById(targetId);
        if (targetElement) {
          targetElement.scrollIntoView({ behavior: 'smooth' });
          // Close mobile nav if open
          const guideNav = document.getElementById('guide-nav');
          guideNav?.classList.remove('open');
        }
      }
    });
  });

  // Initial update
  updateActiveLink();
}

// Set up mobile navigation toggle
function setupMobileNavigation(): void {
  const toggleButton = document.getElementById('guide-nav-toggle');
  const guideNav = document.getElementById('guide-nav');

  if (!toggleButton || !guideNav) {
    return;
  }

  toggleButton.addEventListener('click', () => {
    guideNav.classList.toggle('open');
  });

  // Close nav when clicking outside
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (
      guideNav.classList.contains('open') &&
      !guideNav.contains(target) &&
      !toggleButton.contains(target)
    ) {
      guideNav.classList.remove('open');
    }
  });
}

// Main initialization
function main(): void {
  initTheme();
  setupScrollNavigation();
  setupMobileNavigation();
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
