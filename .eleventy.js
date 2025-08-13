module.exports = function (eleventyConfig) {
	// Basic passthrough copy example, update as per spec
	eleventyConfig.addPassthroughCopy('static')
	return {
		dir: {
			input: 'src',
			output: '_site',
		},
	}
}

