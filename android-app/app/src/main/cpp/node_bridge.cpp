#include <jni.h>
#include <node.h>
#include <cstdlib>
#include <string>
#include <vector>
#include <unistd.h>

extern "C"
JNIEXPORT jint JNICALL
Java_com_beastbotsniper_mobile_NodeBridge_startNodeWithArguments(
        JNIEnv *env, jobject, jobjectArray javaArgs,
        jstring javaWorkingDirectory, jstring javaResearchDirectory) {
    const char *workingDirectory = env->GetStringUTFChars(javaWorkingDirectory, nullptr);
    const char *researchDirectory = env->GetStringUTFChars(javaResearchDirectory, nullptr);
    if (!workingDirectory || !researchDirectory) {
        if (workingDirectory) env->ReleaseStringUTFChars(javaWorkingDirectory, workingDirectory);
        if (researchDirectory) env->ReleaseStringUTFChars(javaResearchDirectory, researchDirectory);
        return -1;
    }
    chdir(workingDirectory);
    setenv("NODE_ENV", "production", 1);
    setenv("PORT", "3000", 1);
    setenv("BEASTBOT_HOST", "127.0.0.1", 1);
    setenv("BEASTBOT_RESEARCH_DIR", researchDirectory, 1);
    setenv("HOME", workingDirectory, 1);
    const std::string temporaryDirectory = std::string(workingDirectory) + "/tmp";
    setenv("TMPDIR", temporaryDirectory.c_str(), 1);

    std::vector<std::string> args;
    const jsize count = env->GetArrayLength(javaArgs);
    args.reserve(static_cast<size_t>(count));
    for (jsize i = 0; i < count; ++i) {
        auto item = static_cast<jstring>(env->GetObjectArrayElement(javaArgs, i));
        const char *value = env->GetStringUTFChars(item, nullptr);
        args.emplace_back(value ? value : "");
        if (value) env->ReleaseStringUTFChars(item, value);
        env->DeleteLocalRef(item);
    }
    std::vector<char *> argv;
    argv.reserve(args.size() + 1);
    for (auto &arg : args) argv.push_back(const_cast<char *>(arg.c_str()));
    argv.push_back(nullptr);

    env->ReleaseStringUTFChars(javaWorkingDirectory, workingDirectory);
    env->ReleaseStringUTFChars(javaResearchDirectory, researchDirectory);
    return node::Start(static_cast<int>(args.size()), argv.data());
}
