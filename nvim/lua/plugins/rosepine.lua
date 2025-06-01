return {
	{
		"rose-pine/neovim",
		styles = {
			transparency = true,
		},
		lazy = false,
		priority = 1000,
		config = function()
			vim.cmd.colorscheme("rose-pine-moon")
			vim.api.nvim_set_hl(0, "Normal", { bg = "none" })
			vim.api.nvim_set_hl(0, "NormalFloat", { bg = "none" })
		end,
	},
}
