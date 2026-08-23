import { describe, expect, test } from 'vitest'
import { ICON_SVG, svgToDataUri } from '../src/pwa/icon'
import { generateManifest, manifestToJson } from '../src/pwa/manifest'
import { escapeAttr, generatePwaHtml } from '../src/pwa/meta-tags'
import type { PwaConfig } from '../src/types'

const defaultPwa: PwaConfig = {
	enabled: true,
	themeColor: '#1e1e2e',
}

describe('SVG icon', () => {
	test('is valid SVG string', () => {
		expect(ICON_SVG).toContain('<svg')
		expect(ICON_SVG).toContain('</svg>')
		expect(ICON_SVG).toContain('xmlns="http://www.w3.org/2000/svg"')
	})

	test('contains catppuccin colours', () => {
		expect(ICON_SVG).toContain('#1e1e2e')
		expect(ICON_SVG).toContain('#a6e3a1')
		expect(ICON_SVG).toContain('#89b4fa')
	})
})

describe('svgToDataUri', () => {
	test('produces base64 data URI', () => {
		const uri = svgToDataUri('<svg/>')
		expect(uri).toMatch(/^data:image\/svg\+xml;base64,/)
	})

	test('round-trips through base64', () => {
		const original = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'
		const uri = svgToDataUri(original)
		const base64Part = uri.replace('data:image/svg+xml;base64,', '')
		const decoded = Buffer.from(base64Part, 'base64').toString('utf-8')
		expect(decoded).toBe(original)
	})
})

describe('generateManifest', () => {
	test('includes name and short_name', () => {
		const manifest = generateManifest('herdweb', defaultPwa)
		expect(manifest.name).toBe('herdweb')
		expect(manifest.short_name).toBe('herdweb')
	})

	test('uses themeColor for background_color and theme_color', () => {
		const manifest = generateManifest('herdweb', defaultPwa)
		expect(manifest.background_color).toBe('#1e1e2e')
		expect(manifest.theme_color).toBe('#1e1e2e')
	})

	test('has display standalone', () => {
		const manifest = generateManifest('herdweb', defaultPwa)
		expect(manifest.display).toBe('standalone')
	})

	test('includes 192 and 512 icons', () => {
		const manifest = generateManifest('herdweb', defaultPwa)
		const sizes = manifest.icons.map((i) => i.sizes)
		expect(sizes).toContain('192x192')
		expect(sizes).toContain('512x512')
	})

	test('icon paths reference /icon-*.png', () => {
		const manifest = generateManifest('herdweb', defaultPwa)
		for (const icon of manifest.icons) {
			expect(icon.src).toMatch(/^\/icon-\d+\.png$/)
		}
	})

	test('prefixes start_url, scope, and icon paths when mounted under a subpath', () => {
		const manifest = JSON.parse(manifestToJson('herdweb', defaultPwa, '/proxy'))
		expect(manifest.start_url).toBe('/proxy/')
		expect(manifest.scope).toBe('/proxy')
		for (const icon of manifest.icons) {
			expect(icon.src.startsWith('/proxy/')).toBe(true)
		}
	})

	test('custom name is reflected', () => {
		const manifest = generateManifest('My Terminal', { ...defaultPwa, shortName: 'Term' })
		expect(manifest.name).toBe('My Terminal')
		expect(manifest.short_name).toBe('Term')
	})

	test('shortName falls back to name when absent', () => {
		const manifest = generateManifest('herdweb', defaultPwa)
		expect(manifest.short_name).toBe('herdweb')
	})

	test('explicit shortName overrides name fallback', () => {
		const manifest = generateManifest('herdweb', { ...defaultPwa, shortName: 'wm' })
		expect(manifest.short_name).toBe('wm')
	})
})

describe('manifestToJson', () => {
	test('produces valid JSON', () => {
		const json = manifestToJson('herdweb', defaultPwa)
		expect(() => JSON.parse(json)).not.toThrow()
	})

	test('parsed JSON matches generateManifest output', () => {
		const json = manifestToJson('herdweb', defaultPwa)
		const parsed = JSON.parse(json)
		const manifest = generateManifest('herdweb', defaultPwa)
		expect(parsed.name).toBe(manifest.name)
		expect(parsed.display).toBe(manifest.display)
		expect(parsed.scope).toBe(manifest.scope)
	})
})

describe('generatePwaHtml', () => {
	test('includes manifest link', () => {
		const html = generatePwaHtml('herdweb', defaultPwa)
		expect(html).toContain('rel="manifest"')
		expect(html).toContain('href="/manifest.json"')
		// Chromium's PWA install check fetches the manifest without cookies unless
		// crossorigin="use-credentials" is set — required behind auth proxies (e.g. Cloudflare Access)
		expect(html).toContain(
			'<link rel="manifest" href="/manifest.json" crossorigin="use-credentials">',
		)
	})

	test('prefixes asset links when mounted under a subpath', () => {
		const html = generatePwaHtml('herdweb', defaultPwa, '/proxy')
		expect(html).toContain('href="/proxy/manifest.json"')
		expect(html).toContain('href="/proxy/apple-touch-icon.png"')
	})

	test('includes theme-color meta', () => {
		const html = generatePwaHtml('herdweb', defaultPwa)
		expect(html).toContain('name="theme-color"')
		expect(html).toContain('content="#1e1e2e"')
	})

	test('includes apple-touch-icon link', () => {
		const html = generatePwaHtml('herdweb', defaultPwa)
		expect(html).toContain('rel="apple-touch-icon"')
		expect(html).toContain('href="/apple-touch-icon.png"')
	})

	test('includes apple-mobile-web-app-title', () => {
		const html = generatePwaHtml('herdweb', defaultPwa)
		expect(html).toContain('apple-mobile-web-app-title')
		expect(html).toContain('content="herdweb"')
	})

	test('includes SVG favicon as data URI', () => {
		const html = generatePwaHtml('herdweb', defaultPwa)
		expect(html).toContain('rel="icon"')
		expect(html).toContain('type="image/svg+xml"')
		expect(html).toContain('data:image/svg+xml;base64,')
	})

	test('uses name arg in apple-mobile-web-app-title', () => {
		const html = generatePwaHtml('My Terminal', defaultPwa)
		expect(html).toContain('content="My Terminal"')
	})

	test('escapes quotes in name and themeColor', () => {
		const html = generatePwaHtml('My "Terminal"', { ...defaultPwa, themeColor: '#1e1e2e"bad' })
		expect(html).toContain('content="My &quot;Terminal&quot;"')
		expect(html).toContain('content="#1e1e2e&quot;bad"')
	})
})

describe('escapeAttr', () => {
	test('escapes ampersands and double quotes', () => {
		expect(escapeAttr('a&b"c')).toBe('a&amp;b&quot;c')
	})

	test('escapes angle brackets', () => {
		expect(escapeAttr('<script>alert("xss")</script>')).toBe(
			'&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
		)
	})

	test('passes through safe strings unchanged', () => {
		expect(escapeAttr('#1e1e2e')).toBe('#1e1e2e')
	})
})
