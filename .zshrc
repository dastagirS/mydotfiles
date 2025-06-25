export ZSH="$HOME/.oh-my-zsh"

ZSH_THEME="robbyrussell"

plugins=(git zsh-autosuggestions)

source $ZSH/oh-my-zsh.sh
alias ohmyzsh="mate ~/.oh-my-zsh"
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$HOME.spicetify:$ANDROID_HOME
# hyprland start on boot
source ~/.config/zshrc.d/dots-hyprland.zsh
