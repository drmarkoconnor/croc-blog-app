const Image = require('@11ty/eleventy-img')

async function imageShortcode(
	src,
	alt = '',
	sizes = '(min-width: 768px) 100vw, 100vw',
	widths = [800, 1200, 1600]
) {
	let metadata = await Image(src, {
		widths,
		formats: ['webp', 'jpeg'],
		outputDir: './_site/assets/img/optimized/',
		urlPath: '/assets/img/optimized/',
	})
	const imageAttributes = {
		alt,
		sizes,
		loading: 'lazy',
		decoding: 'async',
		class: 'hero-img',
	}
	// Return picture element string
	return Image.generateHTML(metadata, imageAttributes)
}

module.exports = function (eleventyConfig) {
	// Passthrough static assets and hero images
	eleventyConfig.addPassthroughCopy({ 'src/assets': 'assets' })
	// Expose quotes.json for client-side fetch
	eleventyConfig.addPassthroughCopy({ 'src/_data/quotes.json': 'quotes.json' })
	// Not required to copy includes, but harmless if left out

	// Image shortcode (Nunjucks)
	eleventyConfig.addNunjucksAsyncShortcode('image', imageShortcode)
	return {
		dir: {
			input: 'src/pages',
			includes: '../_includes',
			data: '../_data',
			output: '_site',
		},
	}
}

