import CommitInfo = Git.CommitInfo

namespace Util {
	export abstract class LineParser {
		protected off = 0
		private prev_off = 0

		protected constructor(protected text: string) {}

		protected rollback() {
			this.off = this.prev_off
		}

		protected next_line(): string | undefined {
			let off = this.off
			const raw = this.text
			const len = raw.length
			if (off == len) return undefined
			while (off < len) {
				const ch = raw[off]
				if (ch == '\r') {
					if (raw[off + 1] == '\n') ++off
					break
				} else if (ch == '\n') {
					break
				}
				++off
			}
			++off
			const line = raw.substring(this.prev_off = this.off, off - 1)
			this.off = off
			return line
		}
	}

	export function collect<T>(iter: { next: () => T | null | undefined }): T[] {
		const res: T[] = []
		let buf: T | null | undefined
		while (true) {
			buf = iter.next()
			if (buf === null || buf === undefined) break
			res.push(buf)
		}
		return res
	}

	export class MarkdownBuilder {
		markdown: string = ""

		constructor() {}

		append<T>(obj: T) {
			this.markdown += obj
			return this
		}

		appendln<T = string>(obj?: T) {
			if (obj !== undefined) this.markdown += obj
			this.markdown += '  \n'
			return this
		}

		link(alt: string, link: string) {
			return this.append("[")
			           .append(alt)
			           .append("](")
			           .append(link)
			           .append(") ")
		}

		code_link(alt: string, link: string) {
			return this.append("[`")
			           .append(alt)
			           .append("`](")
			           .append(link)
			           .append(") ")
		}

		header<T = string>(nth: number, str: T) {
			for (let i = 0; i < nth; i++) this.append("#")
			return this.append(" ").append(str)
		}

		quote<T = string>(text: T) {
			return this.append("> ").appendln(text)
		}

		endsection() {
			return this.append("\n---\n")
		}

		bullet(level = 0) {
			for (let i = 0; i < level; i++) this.append("  ")
			return this.append("+ ")
		}

		block(language: string) {
			return new CodeBlockBuilder(this, language)
		}
	}

	class CodeBlockBuilder {
		constructor(private parent: MarkdownBuilder, language: string) {
			this.parent.append('```').appendln(language)
		}

		append<T = string>(obj: T) {
			this.parent.append(obj)
			return this
		}

		end() {
			return this.parent.appendln('```')
		}
	}
}

namespace Git {
	import LineParser = Util.LineParser

	export function init(path: string): Promise<string> {
		return run(path, "git", "init", ".").catch(it => Promise.resolve(it))
	}

	export function add(path: string, file: string, ...files: string[]) {
		return run(path, "git", "add", file, ...files)
	}

	export function commit(path: string, message: string) {
		return run({cwd: path, env: {GIT_CONFIG_NOSYSTEM: 'true'}},
			"git", "commit", "-m", message)
	}

	export function get_origin(path: string) {
		return run(path, "git", "remote", "get-url", "origin")
			.then(it => it.endsWith(".git\n") ? it.substring(0, it.length - 5) : it.substring(0, it.length - 1))
			.catch(() => undefined)
	}

	export async function logs(path: string): Promise<GitLogParser> {
		const res = await run(path, "git", "log", "--all")
		return new GitLogParser(res)
	}

	export async function show(path: string, commit: string) {
		const res = await run(path, "git", "--no-pager", "show", commit)
		return new GitDiffParser(res, true)
	}

	export async function diff(path: string, commit: string, until?: string) {
		const args = ["git", "--no-pager", "diff", commit + '~']
		if (until) args.push(until)
		const res = await run(path, ...args)
		return new GitDiffParser(res)
	}

	class GitLogParser extends LineParser {
		constructor(raw: string) {super(raw) }

		next(): CommitInfo | undefined {
			let hash: string | undefined = this.next_line()
			if (hash === undefined) return undefined
			if (!hash.length) {
				while (!(hash = this.next_line())) {}
			}
			hash = hash.substring(7)
			const author = this.next_line()?.substring(8)
			const date = this.next_line()?.substring(6)?.trim()
			let message: string = ""
			if (this.next_line()?.trim()?.length! > 0) return undefined
			while (true) {
				const line = this.next_line()
				if (line === undefined || line.length == 0) break
				message += line.substring(4) + '\n'
			}
			message = message?.trim()
			return {hash, author, date, message}
		}
	}

	class GitDiffParser extends LineParser {
		constructor(diff: string, private show_mode?: true) {super(diff)}

		next(): DiffInfo | undefined {
			const d: Partial<DiffInfo> = {}
			d.cmd = this.next_line()
			if (this.show_mode) {
				let cmd = d.cmd
				while (cmd !== undefined && !cmd?.startsWith("diff")) {
					cmd = this.next_line()
				}
				d.cmd = cmd
			}
			if (!d.cmd || !d.cmd.startsWith("diff")) return undefined
			const index = d.index = this.next_line()
			if (index?.startsWith("new")) {
				d.new_file = index
				d.index = this.next_line()
			}
			const src = d.source_path = this.next_line()?.substring(4)
			if (src === undefined) {
				/// diff of empty file
				const [b, a] = d.cmd.split(' ').reverse()
				d.source_path = a
				d.result_path = b
				d.diff = []
				return d as DiffInfo
			}
			d.result_path = this.next_line()?.substring(4)

			const change = this.next_line()
			if (!change) {
				d.diff = []
				return d as DiffInfo
			}
			if (!change.startsWith("@@")) {
				const end_off = change.indexOf("@@", 3)
				console.log(end_off)
				if (!change.endsWith("@@") && end_off != -1) {
					throw Error("Unexpected error (you can try to run again and hope its work)")
				}
				return undefined
			}
			const [src_change, res_change] = change.substring(3, change.length - 3).split(' ')
			const [src_line, src_lines] = src_change.split(',')
			const [res_line, res_lines] = res_change.split(',')
			const src_line_n = parseInt(src_line)
			const src_lines_n = parseInt(src_lines) || 0
			d.source = {
				line : src_line_n,
				lines: src_lines_n,
			}
			const res_line_n = parseInt(res_line)
			const res_lines_n = parseInt(res_lines) || res_line_n
			d.result = {
				line : res_line_n,
				lines: res_lines_n,
			}
			const diffs: Diff[] = []
			for (let i = 0; true; i++) {
				const line = this.next_line()
				if (!line) break
				if (line.startsWith("diff")) {
					this.rollback()
					break
				}
				const diff: Diff = {content: line.substring(1)}
				switch (line[0]) {
					case '+':
						diff.add = true
						break;
					case '-':
						diff.add = false
						break;
					case '\\': // skip
						continue;
				}
				diffs.push(diff)
			}
			d.diff = diffs
			return d as DiffInfo
		}
	}

	export type CommitInfo = {
		hash: string
		author?: string
		message?: string
		date?: string
	}

	export type DiffInfo = {
		cmd: string
		index: string
		new_file?: string
		source_path: string
		result_path: string
		source: {
			line: number
			lines: number
		}
		result: {
			line: number
			lines: number
		}
		diff: Diff[]
	}

	type Diff = {
		add?: boolean
		content: string
	}

	export namespace DiffUtil {
		export function join(diffs: Diff[]): string {
			let res = ""
			for (const {add, content} of diffs) {
				res += add === true ? '+' : (add === false ? '-' : ' ')
				res += content
				res += '\n'
			}
			return res
		}

		export function result(diffs: Diff[]): string {
			let res = ""
			for (const {add, content} of diffs) {
				if (add === false) continue
				res += content
				res += '\n'
			}
			return res
		}

		export function normalize(diffs: Diff[]): Diff[] {
			if (diffs.length < 3) return diffs
			let off = 1
			let prev = diffs[0]
			let add_start = -1 + (prev.add as number)
			const last = diffs.length - 1
			let add_end = last
			while (off < diffs.length) {
				const ptr = diffs[off]
				if (ptr.add) {
					if (add_start == -1) add_start = off
					add_end = off
				}
				if (prev.content == ptr.content) {
					if (prev.add !== undefined && ptr.add !== undefined) {
						diffs.splice(off - 1, 2, {content: ptr.content})
						prev = diffs[off - 1]
						continue
					}
				}
				++off
				prev = ptr
			}
			if (add_start != -1 && add_start != last && add_end != last) {
				delete diffs[add_start].add
				diffs[add_end + 1].add = true
			}
			return diffs
		}
	}
}

let origin: string | undefined = undefined

async function run(cfg: string | { cwd: string, env?: Record<string, string> }, ...cmd: string[]) {
	let cwd: string
	let env: Record<string, string> = {}
	if (typeof cfg == 'string') {
		cwd = cfg
	} else {
		cwd = cfg.cwd
		env = cfg.env || env
	}
	const proc = Deno.run({cmd, cwd, env, stdout: "piped", stderr: "piped"})
	const decoder = new TextDecoder

	if ((await proc.status()).success) {
		return proc.output()
		           .then(it => decoder.decode(it))
	} else {
		return Promise.reject(proc.stderrOutput().then(it => decoder.decode(it)))
	}
}

async function test() {
	const folder_prefix = 'stepdocs-example/stepdocs-example.wiki'
	origin = await Git.get_origin("stepdocs-example")
	const logs = Util.collect(await Git.logs("stepdocs-example"))
	await Deno.mkdir(folder_prefix).catch(() => {})
	const files: { file: string, name: string }[] = []
	for (let i = 0; i < logs.length; i++) {
		const log = logs[i]
		if (!log.message!.match(/\[\d+(\.\d+)*\] .+/gm)) continue
		const {markdown, file, name} = await create_markdown('stepdocs-example', log)
		//	console.log(name)
		const out = `${folder_prefix}/${file}`
		const outdir = out.substring(0, out.lastIndexOf('/'))
		await Deno.mkdir(outdir, {recursive: true}).catch(() => {})
		await Deno.writeTextFile(out, markdown)
		files.push({file, name})

	}
	const file_name_index: Record<string, string> = {}
	for (const {file, name} of files) {
		file_name_index[file] = name
	}
	const docsnorm = new DocsNormalizer(folder_prefix)
	const {steps} = await docsnorm.list_file_flat()
	//console.dir(steps, {depth: 1000})
	// create navigation
	let nav = new Util.MarkdownBuilder()
	let last_step: number = 1
	for (let i = 0; i < steps.length; i++) {
		const prev = steps[i - 1]
		const step = steps[i]
		const next = steps[i + 1]

		if (step.file) {
			if (last_step != step.parts[0]) nav.endsection()
			last_step = step.parts[0]

			const relative_path = step.file.substring(folder_prefix.length + 1)
			//console.log(relative_path)
			const file_name = file_name_index[relative_path]
			nav.bullet(step.parts.length - 1)
			   .link(file_name, relative_path.substring(0, relative_path.length - 3))
			   .appendln()

			/// replace marker
			//console.log(relative_path)
			let contents = await Deno.readTextFile(folder_prefix + '/' + relative_path)
			let prev_content = ""
			let next_content = ""
			if (prev && prev.file) {
				const prev_path = prev.file!.substring(folder_prefix.length + 1)
				const prev_name = file_name_index[prev_path]
				prev_content = `Previous : [${prev_name}](${prev_path.substring(0, prev_path.length - 3)})`
			}
			if (next && next.file) {
				const next_path = next.file!.substring(folder_prefix.length + 1)
				const next_name = file_name_index[next_path]
				next_content = `Next : [${next_name}](${next_path.substring(0, next_path.length - 3)})`
			}
			contents = contents.replace('!!PREV_MARKER!!', prev_content)
			contents = contents.replace('!!NEXT_MARKER!!', next_content)
			await Deno.writeTextFile(folder_prefix + '/' + relative_path, contents)
		}
	}
	await Deno.writeTextFile(folder_prefix + '/_Sidebar.md', nav.markdown)
}

test().catch(async it => console.error(await it))

type StepDocs = {
	commit_hash: string
	name: string
	file: string
	markdown: string
}

function get_file_for_commit(commit: CommitInfo): { name: string, file: string, messages: string[] } {
	const messages = commit.message!.split('\n')
	const name = messages[0]
	let [idx, msg] = name.substring(1).split(']')
	msg = msg.trim()
	const file = `${idx}__${msg.replaceAll(/[\s.]/g, '-').replaceAll(/[?#]/g, '')}.md`

	return {name: `${idx} ${msg}`, file, messages}
}

function pick_language(filename: string): string {
	const ext = filename.substring(filename.lastIndexOf('.') + 1)
	switch (ext) {
		case 'js':
			return 'javascript'
		case 'ts':
			return 'typescript'
		case 'sh':
			return 'shell'
		case 'md':
			return 'markdown'
		default:
			return ext
	}
}

const APP_VERSION = 'stepdocs-prototype-v0.1'
const MODE: 'GHWIKI' | 'MARKDOWN' = 'GHWIKI'

async function create_markdown(path: string, commit: CommitInfo): Promise<StepDocs> {
	const diff = await Git.show(path, commit.hash)
	const {name, file, messages} = get_file_for_commit(commit)
	let markdown = ''//"# " + name + "\n"
	const builder = new Util.MarkdownBuilder()
	if (MODE != 'GHWIKI') builder.header(1, name).appendln()
	builder.appendln('!!PREV_MARKER!!').endsection()
	//markdown += '\n!!PREV_MARKER!!\n\n---\n'

	if (messages.length > 2)
		for (let i = 2; i < messages.length; i++)
			builder.quote(messages[i])
	for (const diff_info of Util.collect(diff)) {

		//console.log(commit, diff_info)
		if (!diff_info.diff?.length) {
			const file_name = diff_info.result_path.substring(2)
			if (origin)
				builder.header(3, "Create empty file at ")
				       .code_link(file_name, origin + '/tree/' + commit.hash + '/' + file_name)
				       .appendln()
			else
				builder.header(3, "Create empty file at `").append(file_name).appendln('`')
		} else {
			const file_name = diff_info.result_path.substring(2)
			if (origin) {
				builder.header(3, "File: ").link(file_name, origin + '/tree/' + commit.hash + '/' + file_name).appendln()
			} else
				builder.header(3, "File: ").appendln(file_name)
			if (diff_info.new_file) {
				builder.block(pick_language(diff_info.result_path))
				       .append(Git.DiffUtil.result(diff_info.diff))
				       .end()
			} else {
				builder.block("diff")
				       .append(Git.DiffUtil.join(Git.DiffUtil.normalize(diff_info.diff)))
				       .end()
			}
		}
	}

	//markdown += '\n\n---\n!!NEXT_MARKER!!\n\n---\n'
	builder.endsection()
	       .appendln("!!NEXT_MARKER!!")
	       .endsection()

	if (origin) {
		builder.append("Commit Hash : ")
		       .link(commit.hash, origin + '/commit/' + commit.hash)
		       .link("View files", origin + '/tree/' + commit.hash)
		       .appendln()
		//	markdown += 'Commit Hash : [' + commit.hash + '](' + origin + '/commit/' + commit.hash + ')'
//		markdown += ' / [View files](' + origin + '/tree/' + commit.hash + ')  \n\n'
	}

	if (commit.author) {
		const username = commit.author.split('<')[0].trim()
		// markdown += '\n\n---\n*Docs by [' + username + '](https://github.com/' + username +
		// 	')* (this docs generated from [*' + APP_VERSION + '*](https://github.com/Wireless4024/stepdocs-proto))\n'
		builder.endsection()
		       .append("*Docs by ")
		       .link(username, "https://github.com/" + username)
		       .append("* (this docs generated from ")
		       .link('*' + APP_VERSION + '*', 'https://github.com/Wireless4024/stepdocs-proto')
		       .append(")")
	}
	return {file, markdown: builder.markdown, commit_hash: commit.hash, name}
}

class DocsNormalizer {
	constructor(private dir: string) {

	}

	async list_file(parent: number[] = []) {
		const steps: Record<number, Step> = {}
		const step_no: number[] = []
		for await (const dirEntry of Deno.readDir(this.dir)) {
			if (dirEntry.isFile) {
				const file = dirEntry
				const file_step = file.name.substring(0, file.name.indexOf("__"))
				console.log(file_step, file_step.includes('-') ? file_step.substring(file_step.lastIndexOf('-') + 1) : file_step)
				const step = parseInt(file_step.includes('-') ? file_step.substring(file_step.lastIndexOf('-') + 1) : file_step)
				if (Number.isNaN(step)) continue
				let entry = steps[step]
				if (!entry) {
					step_no.push(step)
					entry = {file: [this.dir, file.name].join("/"), parts: [...parent, step], child: []}
				}
				entry.file = [this.dir, file.name].join("/")
				steps[step] = entry

			} else {
				const dir = dirEntry
				if (dir.name.startsWith('.')) continue
				const step = parseInt(dir.name)
				let entry = steps[step]
				if (!entry) {
					step_no.push(step)
					entry = {parts: [...parent, step], child: []}
				}
				const child: Step[] = []
				const dn = new DocsNormalizer(this.dir + '-' + dir.name)
				const childs = await dn.list_file([...parent, step])
				const cstep = childs.steps
				for (const step_k in cstep) {
					child.push(cstep[step_k])
				}
				entry.child = child
				steps[step] = entry
			}
		}

		return {steps, step_no}
	}

	async list_file_flat(): Promise<{ steps: Omit<Step, "child">[], step_no: number[] }> {
		/*const {steps: steps_map, step_no} = await this.list_file()
		///const steps = Object.values(steps_map).flatMap(({child, ...it}) => [it, ...child])
		let steps = flaten(Object.values(steps_map))
		step_no.sort((a, b) => a - b)
		steps = steps.filter(it => it.file != undefined)
		             .sort((a, b) => compare_symver(a.parts, b.parts))
		
		return {steps, step_no}
	*/
		const steps: Omit<Step, "child">[] = []

		for await(const file of Deno.readDir(this.dir)) {
			if (file.isFile) {
				const file_name = file.name
				if (!file_name.includes('__')) continue
				const parts = file_name.substring(0, file_name.indexOf('__'))
				                       .split('.')
				                       .map(it => parseInt(it))
				steps.push({parts, file: [this.dir, file_name].join('/')})
			}
		}

		steps.sort((a, b) => compare_symver(a.parts, b.parts))

		return {steps, step_no: []}
	}
}

function flaten(steps: Step[]): Omit<Step, "child">[] {
	if (!steps.length) return steps
	return steps.flatMap(({child, ...it}) => [it, ...flaten(child)])
}

type Step = {
	parts: number[]
	file?: string
	child: Step[]
}

function compare_symver(a: number[], b: number[]) {
	const loop = Math.max(a.length, b.length)
	const aver = a.slice()
	const bver = b.slice()
	for (let i = 0; i < loop; i++) {
		const left = aver.shift()
		const right = bver.shift()
		if (left == null) {
			return right == null ? 0 : -1
		} else {
			if (right == null) return 1
			const cmp = left - right
			if (cmp != 0) return cmp
		}
	}

	return bver.length - aver.length
}