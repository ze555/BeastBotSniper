package com.beastbotsniper.mobile

object NodeBridge {
    init {
        System.loadLibrary("node")
        System.loadLibrary("nodebridge")
    }
    external fun startNodeWithArguments(args: Array<String>, workingDirectory: String, researchDirectory: String): Int
}
