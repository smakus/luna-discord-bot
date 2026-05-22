from .voicebridge import VoiceBridge

async def setup(bot):
    await bot.add_cog(VoiceBridge(bot))
