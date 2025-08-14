#!/usr/bin/env node
// Simple ffmpeg wrapper to encode background videos (MP4/WebM) and poster image.
// Requirements: ffmpeg must be installed on your system (brew install ffmpeg)

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const exec = promisify(execFile)

function parseArgs() {
	const args = process.argv.slice(2)
	const opts = {
		input: '',
		outdir: '.',
		name: 'video',
		height: 1080,
		fps: 24,
		format: 'all',
		crfMp4: 23,
		crfWebm: 33,
		preset: 'slow',
		poster: false,
	}
	for (let i = 0; i < args.length; i++) {
		const a = args[i]
		const val = args[i + 1]
		switch (a) {
			case '--input':
				opts.input = val
				i++
				break
			case '--outdir':
				opts.outdir = val
				i++
				break
			case '--name':
				opts.name = val
				i++
				break
			case '--height':
				opts.height = Number(val) || opts.height
				i++
				break
			case '--fps':
				opts.fps = Number(val) || opts.fps
				i++
				break
			case '--format':
				opts.format = val
				i++
				break
			case '--crf-mp4':
				opts.crfMp4 = Number(val) || opts.crfMp4
				i++
				break
			case '--crf-webm':
				opts.crfWebm = Number(val) || opts.crfWebm
				i++
				break
			case '--preset':
				opts.preset = val
				i++
				break
			case '--poster':
				opts.poster = true
				break
			default:
				break
		}
	}
	if (!opts.input) throw new Error('Missing --input path')
	if (!existsSync(opts.input)) throw new Error(`Input not found: ${opts.input}`)
	return opts
}

async function run(cmd, args) {
	await exec(cmd, args, { stdio: 'inherit' })
}

async function encodeMp4({ input, outdir, name, height, fps, crfMp4, preset }) {
	const out = path.join(outdir, `${name}-${height}p.mp4`)
	const vf = `scale=-2:${height},fps=${fps},format=yuv420p`
	await run('ffmpeg', [
		'-y',
		'-i',
		input,
		'-vf',
		vf,
		'-c:v',
		'libx264',
		'-preset',
		preset,
		'-crf',
		String(crfMp4),
		'-movflags',
		'+faststart',
		'-an',
		out,
	])
	return out
}

async function encodeWebm({ input, outdir, name, height, fps, crfWebm }) {
	const out = path.join(outdir, `${name}-${height}p.webm`)
	const vf = `scale=-2:${height},fps=${fps}`
	await run('ffmpeg', [
		'-y',
		'-i',
		input,
		'-vf',
		vf,
		'-c:v',
		'libvpx-vp9',
		'-b:v',
		'0',
		'-crf',
		String(crfWebm),
		'-row-mt',
		'1',
		'-threads',
		String(Math.max(1, os.cpus().length - 1)),
		'-an',
		out,
	])
	return out
}

async function makePoster({ input, outdir, name, height }) {
	const out = path.join(outdir, `${name}-poster.jpg`)
	await run('ffmpeg', [
		'-y',
		'-i',
		input,
		'-vf',
		`scale=-2:${height}`,
		'-frames:v',
		'1',
		out,
	])
	return out
}

async function main() {
	try {
		const opts = parseArgs()
		const tasks = []
		if (opts.format === 'all' || opts.format === 'mp4')
			tasks.push(encodeMp4(opts))
		if (opts.format === 'all' || opts.format === 'webm')
			tasks.push(encodeWebm(opts))
		if (opts.poster) tasks.push(makePoster(opts))
		const results = await Promise.all(tasks)
		console.log('Done:', results.filter(Boolean))
	} catch (e) {
		console.error('Error:', e.message)
		process.exit(1)
	}
}

main()

