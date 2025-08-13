module.exports = function (eleventyConfig) {
	// Passthrough static assets and hero images
	eleventyConfig.addPassthroughCopy('src/assets')
	eleventyConfig.addPassthroughCopy('src/_includes')
	return {
		dir: {
			input: 'src/pages',
			includes: '../_includes',
			data: '../_data',
			output: '_site',
		},
	}
}

