import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, test } from 'vitest'

/**
 * Guards against drift between the runtime dispatch outcome variants in
 * `NotifyDispatchResult` (`src/notify/service.ts`) and the push delivery contract
 * table in `docs/configuration.md`.
 *
 * `POST /api/events` responds with HTTP 202 and a JSON body containing `{ outcome, reason }`.
 * Accepted does not mean delivered: each outcome represents a distinct lifecycle
 * (immediate dispatch, deliberate withholding, 300s presence deferral, 600s done coalescing,
 * or deduplication discard). If an engineer adds, removes, or renames an outcome in
 * TypeScript without updating the documentation contract (or vice versa), this test fails.
 *
 * Both sources are parsed structurally:
 * - TypeScript source is inspected via the TypeScript compiler AST (no fuzzy regexes).
 * - Documentation is parsed as a Markdown table with an "Outcome" column under Push notifications.
 *
 * The assertion verifies set equality: neither side may contain missing or extra entries,
 * and deleting the documentation table outright will throw rather than vacuously pass.
 */

const repoRoot = join(import.meta.dirname, '..')
const serviceTsPath = join(repoRoot, 'src/notify/service.ts')
const configDocPath = join(repoRoot, 'docs/configuration.md')

function extractOutcomeProperty(member: ts.TypeNode): string {
	if (!ts.isTypeLiteralNode(member)) {
		throw new Error(
			`Expected TypeLiteralNode in NotifyDispatchResult, got ${ts.SyntaxKind[member.kind]}`,
		)
	}
	const prop = member.members.find(
		(m): m is ts.PropertySignature =>
			ts.isPropertySignature(m) && ts.isIdentifier(m.name) && m.name.text === 'outcome',
	)
	if (!prop || !prop.type) {
		throw new Error('Missing "outcome" property in NotifyDispatchResult member')
	}
	if (!ts.isLiteralTypeNode(prop.type) || !ts.isStringLiteral(prop.type.literal)) {
		throw new Error('Property "outcome" must be a string literal type')
	}
	return prop.type.literal.text
}

function parseTypeOutcomes(serviceTsContent: string): Set<string> {
	const sourceFile = ts.createSourceFile(
		'service.ts',
		serviceTsContent,
		ts.ScriptTarget.Latest,
		true,
	)
	let unionNode: ts.UnionTypeNode | undefined

	ts.forEachChild(sourceFile, (node) => {
		if (
			ts.isTypeAliasDeclaration(node) &&
			node.name.text === 'NotifyDispatchResult' &&
			ts.isUnionTypeNode(node.type)
		) {
			unionNode = node.type
		}
	})

	if (!unionNode) {
		throw new Error('Could not find type alias NotifyDispatchResult with union type in service.ts')
	}

	const outcomes = new Set<string>()
	for (const member of unionNode.types) {
		outcomes.add(extractOutcomeProperty(member))
	}
	return outcomes
}

function splitMarkdownRow(line: string): string[] {
	return line
		.split('|')
		.slice(1, -1)
		.map((cell) => cell.trim())
}

function findOutcomeTable(lines: readonly string[]): {
	startLine: number
	colIndex: number
} {
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]?.trim() ?? ''
		if (!line.startsWith('|') || !line.endsWith('|')) continue
		const cells = splitMarkdownRow(line)
		const colIndex = cells.findIndex((c) => c.toLowerCase() === 'outcome')
		if (colIndex !== -1) {
			const nextLine = lines[i + 1]?.trim() ?? ''
			if (/^\|(?:\s*:?-+:?\s*\|)+$/.test(nextLine)) {
				return { startLine: i + 2, colIndex }
			}
		}
	}
	throw new Error(
		'Could not find markdown table header with "Outcome" column in docs/configuration.md',
	)
}

function parseDocOutcomes(docContent: string): Set<string> {
	const lines = docContent.split('\n')
	const { startLine, colIndex } = findOutcomeTable(lines)
	const outcomes = new Set<string>()

	for (let i = startLine; i < lines.length; i++) {
		const line = lines[i]?.trim() ?? ''
		if (!line.startsWith('|') || !line.endsWith('|')) {
			break
		}
		const cells = splitMarkdownRow(line)
		if (colIndex >= cells.length) {
			throw new Error(`Table row missing outcome column index ${colIndex}: "${line}"`)
		}
		const cleaned = cells[colIndex]?.replace(/`/g, '').trim() ?? ''
		if (cleaned.length === 0) {
			throw new Error(`Empty outcome cell in table row: "${line}"`)
		}
		outcomes.add(cleaned)
	}

	if (outcomes.size === 0) {
		throw new Error('No outcomes parsed from the outcome table in docs/configuration.md')
	}

	return outcomes
}

describe('notify outcome contract parity', () => {
	test('docs/configuration.md outcome table matches NotifyDispatchResult union members exactly', () => {
		const serviceTsContent = readFileSync(serviceTsPath, 'utf8')
		const docContent = readFileSync(configDocPath, 'utf8')

		const typeOutcomes = parseTypeOutcomes(serviceTsContent)
		const docOutcomes = parseDocOutcomes(docContent)

		// Assert exact set equality via sorted arrays
		expect([...docOutcomes].sort()).toEqual([...typeOutcomes].sort())
	})
})
